import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import type { ContactResponse } from '../api/schemas';
import { recordConsent, type ConsentPurpose } from './consents';
import { writeContact } from './contacts';
import { getContactById } from './contacts-query';
import { writeSubscriptionIn } from './subscriptions';
import { addTagsToContact, ensureTags } from './tags';

/**
 * Zápis kontaktu tak, jak ho posílá REST API: kontakt, štítky, seznamy a souhlasy
 * v jednom volání.
 *
 * Vlastní pravidla zápisu tady NEJSOU. Kontakt vzniká výhradně přes `writeContact`,
 * které drží všech šest pravidel z 4.1.3 části 2 a dopočítává oslovení; tenhle soubor
 * jen rozbaluje tvar požadavku na volání, která už existují. Kdyby si pravidla psal
 * handler, musely by je znovu napsat i formulář a příchozí webhook.
 */

export type ContactUpsertBody = {
  email: string;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
  full_name?: string | null | undefined;
  title_prefix?: string | null | undefined;
  title_suffix?: string | null | undefined;
  gender?: 'female' | 'male' | 'unknown' | undefined;
  locale?: string | undefined;
  external_id?: string | null | undefined;
  attributes?: Record<string, unknown> | undefined;
  tags?: string[] | undefined;
  lists?: { list_id: string; status?: 'pending' | 'confirmed' | undefined }[] | undefined;
  consent?:
    | {
        purpose: ConsentPurpose;
        status: 'granted' | 'withdrawn';
        legal_basis: 'consent' | 'legitimate_interest' | 'contract' | 'soft_opt_in';
        consent_text?: string | undefined;
        occurred_at?: string | undefined;
        evidence?: Record<string, unknown> | undefined;
      }[]
    | undefined;
  on_conflict?: 'create' | 'skip' | 'update' | 'overwrite' | undefined;
  source?: string | undefined;
};

/** Zdroje povolené omezením `ck_contacts__source`. Cizí hodnota by shodila zápis na 23514. */
const ALLOWED_SOURCES = new Set([
  'manual',
  'import',
  'api',
  'form',
  'webhook',
  'double_opt_in',
  'migration',
]);

function sourceOf(raw: string | undefined): string {
  return raw !== undefined && ALLOWED_SOURCES.has(raw) ? raw : 'api';
}

export async function upsertContactFromApi(
  ctx: WorkspaceContext,
  body: ContactUpsertBody,
): Promise<{ contact: ContactResponse; created: boolean }> {
  const result = await writeContact(ctx, {
    email: body.email,
    fullName: body.full_name ?? null,
    firstName: body.first_name ?? null,
    lastName: body.last_name ?? null,
    titlePrefix: body.title_prefix ?? null,
    titleSuffix: body.title_suffix ?? null,
    ...(body.gender === undefined ? {} : { gender: body.gender }),
    ...(body.locale === undefined ? {} : { locale: body.locale }),
    externalId: body.external_id ?? null,
    attributes: body.attributes ?? {},
    source: sourceOf(body.source),
    mode: body.on_conflict ?? 'update',
  });

  // Pravidlo 4: adresa po stížnosti nebo po výmazu se nesmí vrátit ani přes API.
  // Kód `contact_suppressed` není kořenový kód registru P01, takže jde do params.detail
  // stejně jako u ostatních doménových odmítnutí v téhle doméně.
  if (result.rejected === 'suppressed') {
    throw new ApiError('conflict', { params: { detail: 'contact_suppressed' } });
  }

  const contactId = result.id;

  if (body.tags !== undefined && body.tags.length > 0) {
    await addTagsToContact(ctx, contactId, await ensureTags(ctx, body.tags));
  }

  if (body.lists !== undefined && body.lists.length > 0) {
    await withWorkspace(ctx, async (tx) => {
      for (const item of body.lists ?? []) {
        await writeSubscriptionIn(tx, ctx, {
          contactId,
          listId: item.list_id,
          status: item.status ?? 'pending',
          source: 'api',
          confirmedAt: item.status === 'confirmed' ? new Date() : null,
        });
      }
    });
  }

  for (const consent of body.consent ?? []) {
    await recordConsent(ctx, {
      contactId,
      purpose: consent.purpose,
      status: consent.status,
      legalBasis: consent.legal_basis,
      scopeListId: null,
      source: 'api',
      ...(consent.consent_text === undefined ? {} : { consentText: consent.consent_text }),
      ...(consent.occurred_at === undefined ? {} : { occurredAt: new Date(consent.occurred_at) }),
    });
  }

  const contact = await getContactById(ctx, contactId);
  if (contact === null) throw new ApiError('not_found');
  return { contact, created: result.inserted };
}

/**
 * Částečná úprava. Adresa se z těla NEBERE: změnu adresy má vlastní endpoint, protože
 * musí přepočítat otisky a ověřit kolizi s živým kontaktem.
 */
export async function patchContact(
  ctx: WorkspaceContext,
  contactId: string,
  body: Omit<ContactUpsertBody, 'email' | 'on_conflict'>,
): Promise<ContactResponse | null> {
  const current = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);
    return rows[0] ?? null;
  });
  if (current === null) return null;

  const { contact } = await upsertContactFromApi(ctx, {
    ...body,
    email: current.email,
    on_conflict: 'update',
  });
  return contact;
}

export type BatchItemResult = {
  index: number;
  status: 'created' | 'updated' | 'skipped' | 'error';
  id?: string;
  error?: { code: string };
};

/**
 * Dávkový zápis. Jedna vadná položka nesmí shodit celou dávku, proto se chyby chytají
 * po položkách a vracejí se s indexem: klient přesně ví, který řádek opravit.
 */
export async function batchUpsertFromApi(
  ctx: WorkspaceContext,
  items: readonly ContactUpsertBody[],
): Promise<{ results: BatchItemResult[] }> {
  const results: BatchItemResult[] = [];

  for (const [index, item] of items.entries()) {
    try {
      const { contact, created } = await upsertContactFromApi(ctx, item);
      results.push({ index, status: created ? 'created' : 'updated', id: contact.id });
    } catch (error) {
      const code =
        error instanceof ApiError
          ? typeof error.params?.['detail'] === 'string'
            ? error.params['detail']
            : error.code
          : 'internal_error';
      results.push({ index, status: 'error', error: { code } });
    }
  }

  return { results };
}
