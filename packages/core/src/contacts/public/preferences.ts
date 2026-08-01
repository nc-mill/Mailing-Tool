import { sql } from 'drizzle-orm';
import { withWorkspace } from '../../tx';
import { snooze } from '../lists/unsubscribe';
import { subscribeToList } from '../lists/subscribe-service';
import { listContactFields } from '../repo/contact-fields';
import { createGdprRequest } from '../repo/gdpr';
import { writeContact } from '../repo/contacts';
import { coerceValue, type FieldDefinition } from '../fields/coerce';
import { readContactsSettings } from '../settings';
import { loadContact } from './context';
import { unsubscribeByToken, type VerifiedPublicToken } from './unsubscribe';

export type PreferenceList = {
  id: string;
  name: string;
  subscribed: boolean;
  subscribedAt: Date | null;
};

export type EditableField = { key: string; label: Record<string, string>; value: string };

export type PreferencesData = {
  contactId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  locale: string;
  availableLocales: string[];
  lists: PreferenceList[];
  editableFields: EditableField[];
};

/** Jazyky, které smí příjemce vybrat. Katalog aplikace vlastní P05, tohle je jeho podmnožina. */
const AVAILABLE_LOCALES = ['cs', 'en'];

export async function loadPreferencesData(
  token: VerifiedPublicToken,
): Promise<PreferencesData | null> {
  const ctx = token.scope.ctx;
  const contact = await loadContact(ctx, token.data.contactId);
  if (contact === null) return null;

  const [lists, fields] = await Promise.all([
    withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{
        id: string;
        name: string;
        status: string | null;
        subscribed_at: string | null;
      }>(sql`
        SELECT l.id, l.name, s.status, s.subscribed_at
          FROM lists l
          LEFT JOIN list_subscriptions s
                 ON s.list_id = l.id AND s.contact_id = ${contact.id}::uuid
                AND s.workspace_id = ${ctx.workspaceId}::uuid
         WHERE l.workspace_id = ${ctx.workspaceId}::uuid
           AND l.deleted_at IS NULL
         ORDER BY l.name
      `);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        subscribed: row.status === 'confirmed',
        subscribedAt: row.subscribed_at === null ? null : new Date(row.subscribed_at),
      }));
    }),
    listContactFields(ctx),
  ]);

  return {
    contactId: contact.id,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    locale: contact.locale,
    availableLocales: AVAILABLE_LOCALES,
    lists,
    // Jen pole s příznakem subject_editable. Server hodnoty mimo tenhle seznam ZAHODÍ,
    // i kdyby je někdo do těla dopsal ručně; příznak není jen o tom, co se vykreslí.
    editableFields: fields
      .filter((field) => field.subjectEditable)
      .map((field) => ({
        key: field.key,
        label: field.label,
        value: String(contact.attributes[field.key] ?? ''),
      })),
  };
}

export type PreferenceAction =
  | { kind: 'update_lists'; listIds: string[] }
  | { kind: 'snooze'; days: 30 | 60 | 90 }
  | {
      kind: 'update';
      locale?: string;
      firstName?: string;
      lastName?: string;
      attributes: Record<string, string>;
    }
  | { kind: 'unsubscribe_all' }
  | { kind: 'export_data' }
  | { kind: 'erase_data' };

export type PreferenceOutcome = { applied: PreferenceAction['kind'] };

/**
 * Provede akci ze stránky předvoleb. Všechny běží přes POST a odpovídá se 303 na tutéž
 * adresu, takže stránka funguje bez JavaScriptu a obnovení stránky nic nezopakuje.
 */
export async function applyPreferenceAction(
  token: VerifiedPublicToken,
  action: PreferenceAction,
): Promise<PreferenceOutcome> {
  const ctx = token.scope.ctx;
  const contactId = token.data.contactId;

  switch (action.kind) {
    case 'update_lists': {
      const data = await loadPreferencesData(token);
      if (data === null) break;
      for (const list of data.lists) {
        const wanted = action.listIds.includes(list.id);
        if (wanted === list.subscribed) continue;
        if (wanted) {
          await subscribeToList(ctx, {
            listId: list.id,
            email: data.email,
            source: 'preference_center',
            // Ze stránky předvoleb je totožnost prokázaná držením podepsaného tokenu
            // z e-mailu, který jsme sami odeslali, takže druhé potvrzení nedává smysl.
            skipConfirmation: true,
          });
        } else {
          await unsubscribeByToken(
            { ...token, data: { ...token.data, listId: list.id } },
            { reason: 'preference_center' },
          );
        }
      }
      break;
    }

    case 'snooze':
      await snooze(ctx, { contactId, listId: null, days: action.days });
      break;

    case 'update': {
      const data = await loadPreferencesData(token);
      if (data === null) break;
      const settings = await withWorkspace(ctx, async (tx) => readContactsSettings(tx, ctx));
      const fields = await listContactFields(ctx);

      const attributes: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(action.attributes)) {
        const field = fields.find((candidate) => candidate.key === key);
        // Pole bez příznaku subject_editable se ZAHAZUJE. Kontrola je tady, na serveru,
        // ne jen v tom, co se vykreslilo: tělo požadavku napíše kdokoliv.
        if (field === undefined || !field.subjectEditable) continue;
        const coerced = coerceValue(raw, toFieldDefinition(field), {
          numberFormat: settings.number_format,
          dateFormat: settings.date_format,
          defaultCountry: settings.default_country,
        });
        if (coerced.ok) attributes[key] = coerced.value;
      }

      // Zápis jde přes `writeContact`, ne přímým UPDATE: oslovení a vokativ se počítají
      // při zápisu, takže změna jazyka nebo jména musí projít touhle cestou, jinak by
      // v e-mailu zůstalo staré oslovení.
      await writeContact(ctx, {
        email: data.email,
        firstName: action.firstName ?? data.firstName,
        lastName: action.lastName ?? data.lastName,
        locale: action.locale ?? data.locale,
        // `ck_contacts__source` z P03 hodnotu 'preference_center' NEZNÁ (na rozdíl
        // od `ck_consents__source`), takže by zápis spadl na 23514. Nejbližší povolená
        // hodnota je 'api': je to změna vyžádaná subjektem, ne nový zdroj kontaktu,
        // a u režimu update se stejně uplatní jen při vzniku řádku.
        source: 'api',
        attributes,
        mode: 'update',
      });
      break;
    }

    case 'unsubscribe_all':
      await unsubscribeByToken(token, { reason: 'preference_center', forceGlobal: true });
      break;

    case 'export_data': {
      const contact = await loadContact(ctx, contactId);
      if (contact !== null) {
        await createGdprRequest(ctx, {
          email: contact.email,
          type: 'access',
          channel: 'preference_center',
        });
      }
      break;
    }

    case 'erase_data': {
      const contact = await loadContact(ctx, contactId);
      if (contact !== null) {
        await createGdprRequest(ctx, {
          email: contact.email,
          type: 'erasure',
          mode: 'anonymize',
          channel: 'preference_center',
        });
      }
      break;
    }
  }

  return { applied: action.kind };
}

function toFieldDefinition(field: {
  key: string;
  type: string;
  options: Record<string, unknown>;
}): FieldDefinition {
  return { key: field.key, type: field.type as FieldDefinition['type'], options: field.options };
}
