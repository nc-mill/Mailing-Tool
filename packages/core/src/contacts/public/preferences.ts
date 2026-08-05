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
import { publicListLabel } from './list-label';
import { unsubscribeByToken, type VerifiedPublicToken } from './unsubscribe';

export type PreferenceList = {
  id: string;
  /** Jméno v podobě pro příjemce: `public_name`, a když chybí, pracovní `name`. */
  name: string;
  /** Věta pod zaškrtávátkem: co v odběru chodí. null znamená, že ji správce nenapsal. */
  description: string | null;
  subscribed: boolean;
  /**
   * Čeká přihlášení na potvrzení v e-mailu?
   *
   * Bez toho vypadá stránka rozbitě: kdo se dřív odhlásil a teď se zaškrtnutím vrací,
   * skončí na `pending`, protože stavový automat odmítá vrátit odhlášeného člověka
   * rovnou do rozesílky. Zaškrtnutí se pak po uložení samo odškrtne a nikde není
   * napsané proč.
   */
  pending: boolean;
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
  /**
   * Seznamy, které se PŘÍJEMCI NABÍZEJÍ, tedy jen ty s `public_visible`. Prázdné pole
   * znamená, že správce veřejně nenabízí nic, a stránka pak blok se seznamy vůbec
   * nevykreslí. Nikdy tu nejsou seznamy, do kterých se nesmí přihlásit sám: dokud
   * je stránka vypisovala všechny, mohl se kdokoli s odhlašovacím odkazem přihlásit
   * třeba do seznamu „VIP" a začít dostávat slevy, na které nemá nárok.
   */
  lists: PreferenceList[];
  editableFields: EditableField[];
  /**
   * Je celé centrum předvoleb zapnuté? Když ne, stránka nabídne JEN odhlášení
   * (`settings.contacts.public_preference_center`).
   */
  preferenceCenter: boolean;
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
      /*
       * `WHERE l.public_visible` je bezpečnostní podmínka, ne filtr pro vzhled.
       * Seznam je v tomhle systému nositelem oprávnění k rozesílce, takže dokud tenhle
       * dotaz vracel všechny seznamy projektu, mohl se držitel jakéhokoli odhlašovacího
       * odkazu sám přihlásit do seznamu „VIP" nebo „Zákazníci se slevou" a začít
       * dostávat nabídky, na které nemá nárok. `applyPreferenceAction` níž pracuje
       * s TÍMTO seznamem, takže podmínka platí i pro zápis, ne jen pro to, co se vykreslí.
       *
       * Řadí se podle jména VIDITELNÉHO PŘÍJEMCI, ne podle pracovního: kdyby se řadilo
       * podle `l.name`, mělo by pořadí na stránce logiku, kterou příjemce nemá jak vidět.
       */
      const { rows } = await tx.execute<{
        id: string;
        name: string;
        public_name: string | null;
        public_description: string | null;
        status: string | null;
        subscribed_at: string | null;
      }>(sql`
        SELECT l.id, l.name, l.public_name, l.public_description, s.status, s.subscribed_at
          FROM lists l
          LEFT JOIN list_subscriptions s
                 ON s.list_id = l.id AND s.contact_id = ${contact.id}::uuid
                AND s.workspace_id = ${ctx.workspaceId}::uuid
         WHERE l.workspace_id = ${ctx.workspaceId}::uuid
           AND l.deleted_at IS NULL
           AND l.public_visible
         ORDER BY coalesce(nullif(btrim(l.public_name), ''), l.name)
      `);
      return rows.map((row) => ({
        id: row.id,
        name: publicListLabel({ name: row.name, publicName: row.public_name }),
        description: row.public_description,
        subscribed: row.status === 'confirmed',
        pending: row.status === 'pending',
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
    lists: token.scope.preferenceCenter ? lists : [],
    preferenceCenter: token.scope.preferenceCenter,
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

export type PreferenceOutcome = {
  applied: PreferenceAction['kind'];
  /**
   * Provedla se akce doopravdy? `false` znamená, že ji projekt vůbec nenabízí
   * (vypnuté centrum předvoleb). Volající podle toho pozná, že nemá vypisovat
   * potvrzení o něčem, co se nestalo.
   */
  performed: boolean;
};

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

  /*
   * S VYPNUTÝM CENTREM PŘEDVOLEB PROJDE JEN ODHLÁŠENÍ.
   *
   * Kontrola je tady, na serveru, ne jen v tom, co se vykreslilo: tělo požadavku napíše
   * kdokoli a odkaz na předvolby je bez expirace, takže „stránka to nenabízí" není žádná
   * ochrana. Odhlášení je z pravidla vyňaté schválně, vypnout ho nejde: je to zákonná
   * povinnost, ne nastavení.
   */
  if (!token.scope.preferenceCenter && action.kind !== 'unsubscribe_all') {
    return { applied: action.kind, performed: false };
  }

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

  return { applied: action.kind, performed: true };
}

function toFieldDefinition(field: {
  key: string;
  type: string;
  options: Record<string, unknown>;
}): FieldDefinition {
  return { key: field.key, type: field.type as FieldDefinition['type'], options: field.options };
}
