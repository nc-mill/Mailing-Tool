import { z } from '@hono/zod-openapi';
import type { ValidationIssue } from '../../errors/api-error';
import {
  CountSchema,
  IdempotencyHeaderSchema,
  PaginationSchema,
  paginated,
  problemResponse,
  type ApiEnv,
} from '../../identity/api/schemas';
import { normalizeEmail } from '../email';

/**
 * Sdílená schémata veřejného REST API domény kontaktů.
 *
 * Konvence z kapitoly 4.1 části 1, které tenhle soubor vynucuje pro všechny route soubory:
 *   - klíče těla jsou snake_case, protože tak vypadá celé API,
 *   - každé tělo je .strict(), takže překlep v klíči skončí 422 a ne tichým zahozením hodnoty,
 *   - čas je ISO 8601 v UTC s milisekundami a se Z, nikdy s posunem,
 *   - stránkování je kurzorové a celkový počet se v seznamu nevrací nikdy.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán zakládal vlastní `PaginationSchema`,
 * `paginated()`, `CountResponseSchema` a `problemResponse()`. Všechny čtyři už existují
 * v `identity/api/schemas.ts`, kde je vlastní P04, a mají tytéž tvary. Druhá definice by
 * zaregistrovala komponentu `Pagination` podruhé a generátor OpenAPI by na duplicitě spadl.
 * Tenhle soubor je proto REEXPORTUJE a přidává jen to, co v P04 opravdu není.
 */

export { CountSchema as CountResponseSchema, IdempotencyHeaderSchema, PaginationSchema };
export { paginated, problemResponse };
export type { ApiEnv };

/**
 * ISO 8601, UTC, přesně tři desetinná místa, sufix Z.
 *
 * Regulární výraz místo z.iso.datetime() je vědomý: chceme jediný povolený tvar, ne rodinu
 * tvarů. Posun +02:00 je platné ISO 8601, ale ve dvou různých odpovědích by znamenal dva
 * různé texty pro tentýž okamžik a klient by je nemohl porovnávat jako řetězce.
 * Date.prototype.toISOString() vrací přesně tenhle tvar, takže serializace je zdarma.
 */
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const IsoDateTime = z
  .string()
  .regex(ISO_UTC_MS, { message: 'invalid_datetime' })
  .openapi('IsoDateTime', { example: '2026-07-31T10:15:30.000Z' });

/** Serializace času do odpovědi. Jediná povolená cesta, jak se datum dostane ven. */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // Ovladač vydává timestamptz přes syrové SQL jako řetězec, ne jako Date. Kdyby se tady
  // volalo rovnou .toISOString(), spadlo by to za běhu na TypeError a typová kontrola
  // by to nechytila. Viz komentář u ConsentRow v repo/consents.ts.
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** Povinný čas do odpovědi. Použij tam, kde sloupec je NOT NULL. */
export function toIsoRequired(value: Date | string): string {
  return toIso(value) as string;
}

export const Uuid = z.uuid();

/**
 * Vstupní e-mail. Schéma rovnou normalizuje, takže handler dostane hodnotu, kterou uvidí
 * databáze. Bez toho by se normalizace musela opakovat v každém handleru a jedna zapomenutá
 * by vyrobila druhý kontakt na tutéž adresu (4.1.1 části 2).
 */
export const EmailInput = z
  .string()
  .transform((raw, ctx) => {
    const result = normalizeEmail(raw);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.code });
      return z.NEVER;
    }
    return result.email;
  })
  .openapi({ type: 'string', format: 'email', example: 'jan@example.cz' });

/**
 * Query parametry kurzorového seznamu. Povolené hodnoty order předává každý zdroj sám,
 * protože každá z nich musí mít krycí index; volný text by znamenal seřazení celé tabulky.
 *
 * Query se záměrně NEvaliduje jako strict. Tělo ano, query ne: do URL přidávají parametry
 * proxy, analytika i poštovní klienti a odmítnout požadavek kvůli utm_source by bylo směšné.
 */
export function cursorQuery<const T extends readonly [string, ...string[]]>(
  orders: T,
  defaultOrder: T[number],
) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().min(1).max(1024).optional(),
    order: z.enum(orders).default(defaultOrder),
  });
}

export const IdParam = z.object({ id: Uuid });

/** Hodnota vlastního pole. Pole řetězců je multiselect, null hodnotu maže. */
export const AttributeValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export const ConsentInput = z
  .object({
    purpose: z.enum([
      'email_marketing',
      'analytics',
      'personalization',
      'profiling',
      'third_party',
    ]),
    status: z.enum(['granted', 'withdrawn']),
    legal_basis: z.enum(['consent', 'legitimate_interest', 'contract', 'soft_opt_in']),
    consent_text: z.string().max(4000).optional(),
    occurred_at: IsoDateTime.optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .openapi('ConsentInput');

export const ContactUpsertRequestSchema = z
  .object({
    email: EmailInput,
    first_name: z.string().max(100).nullable().optional(),
    last_name: z.string().max(100).nullable().optional(),
    full_name: z.string().max(200).nullable().optional(),
    title_prefix: z.string().max(50).nullable().optional(),
    title_suffix: z.string().max(50).nullable().optional(),
    gender: z.enum(['female', 'male', 'unknown']).optional(),
    /**
     * Stav kontaktu, který volající TVRDÍ. Schválně jen dvě hodnoty z šesti, které
     * sloupec `contacts.status` zná.
     *
     * `unsubscribed`, `bounced` a `complained` jsou VÝSLEDKY, ne přání: vznikají
     * odhlášením člověka, odrazem od poštovního serveru nebo stížností a mají vlastní
     * cestu se záznamem v auditu. `deleted` patří mazání. Kdyby je šlo nastavit zápisem,
     * dala by se přes tenhle endpoint vyrobit stížnost, která se nikdy nestala, a
     * `applyWriteRules` by ji navíc zamklo (`LOCKED_STATUSES`), takže by z ní nebylo cesty ven.
     *
     * Povýšit `unconfirmed` na `active` smí jen ten, kdo za tvrzení nese odpovědnost:
     * správce u ručního zadání nebo import s prohlášením o doloženém souhlasu. Pravidlo 3
     * ze 4.1.2 části 2 dál platí a hlídá `applyWriteRules`: zamknutý stav se tímhle polem
     * přepsat NEDÁ.
     */
    status: z.enum(['active', 'unconfirmed']).optional(),
    /** Zadání vokativu zamkne přepočet, viz 4.4.8 části 2. */
    first_name_vocative: z.string().max(100).nullable().optional(),
    last_name_vocative: z.string().max(100).nullable().optional(),
    locale: z.string().max(35).optional(),
    external_id: z.string().max(255).nullable().optional(),
    attributes: z.record(z.string(), AttributeValue).optional(),
    tags: z.array(z.string().max(80)).max(50).optional(),
    lists: z
      .array(
        z.object({ list_id: Uuid, status: z.enum(['pending', 'confirmed']).optional() }).strict(),
      )
      .max(50)
      .optional(),
    consent: z.array(ConsentInput).max(10).optional(),
    on_conflict: z.enum(['create', 'skip', 'update', 'overwrite']).default('update'),
    source: z.string().max(80).optional(),
  })
  .strict()
  .openapi('ContactUpsertRequest');

export const ContactResponseSchema = z
  .object({
    id: Uuid,
    email: z.string(),
    status: z.enum(['active', 'unconfirmed', 'unsubscribed', 'bounced', 'complained', 'deleted']),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    middle_name: z.string().nullable(),
    title_prefix: z.string().nullable(),
    title_suffix: z.string().nullable(),
    gender: z.enum(['female', 'male', 'unknown']),
    gender_source: z.string(),
    first_name_vocative: z.string().nullable(),
    last_name_vocative: z.string().nullable(),
    vocative_confidence: z.enum(['high', 'low', 'none']),
    vocative_locked: z.boolean(),
    greeting: z.string(),
    locale: z.string(),
    attributes: z.record(z.string(), z.unknown()),
    tags: z.array(z.object({ id: Uuid, name: z.string() })),
    lists: z.array(
      z.object({
        list_id: Uuid,
        name: z.string(),
        status: z.string(),
        subscribed_at: IsoDateTime,
        confirmed_at: IsoDateTime.nullable(),
        snooze_until: IsoDateTime.nullable(),
      }),
    ),
    consents: z.array(
      z.object({
        purpose: z.string(),
        status: z.string(),
        legal_basis: z.string(),
        since: IsoDateTime,
      }),
    ),
    suppression: z.object({ reason: z.string(), created_at: IsoDateTime }).nullable(),
    processing_restricted: z.boolean(),
    source: z.string(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
    last_activity_at: IsoDateTime.nullable(),
  })
  .openapi('Contact');

export type ContactResponse = z.infer<typeof ContactResponseSchema>;

/**
 * Překlad zod chyby do pole errors[] odpovědi validation_failed (4.8 části 1).
 *
 * Kódy jsou z CONTACTS_FIELD_ERROR_CODES, aby klient mohl chybu zpracovat strojově a nemusel
 * parsovat anglickou větu. Jedna zod issue je právě jedna položka; pořadí se zachovává,
 * protože formulář podle něj skáče na první chybné pole.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ ZMRAZENÝM TVAREM ODPOVĚDI. Plán vracel dvojici
 * `{ field, code }`. Obálka RFC 9457 z kapitoly 4.8 části 1 má v `errors[]` trojici
 * `{ path, code, message }` a vlastní ji P04; `ApiError` jiný tvar ani nepřijme.
 * Vrací se proto `ValidationIssue`, tedy `path` místo `field` a navíc `message`.
 */
export function toFieldErrors(error: z.ZodError): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.');

    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        out.push({
          path: path === '' ? key : `${path}.${key}`,
          code: 'unknown_field_key',
          message: `Neznámý klíč "${key}".`,
        });
      }
      continue;
    }

    out.push({ path, code: fieldErrorCode(issue), message: issue.message });
  }

  // Prázdné pole by znamenalo 422 bez jediného vodítka, což je horší než obecný kód.
  if (out.length === 0) out.push({ path: '', code: 'invalid_value', message: 'Neplatná hodnota.' });
  return out;
}

function fieldErrorCode(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'custom':
      // Sem padá EmailInput s kódem invalid_email nebo email_too_long.
      return typeof issue.message === 'string' && issue.message !== ''
        ? issue.message
        : 'invalid_value';
    case 'invalid_type':
      return issue.input === undefined
        ? 'required_field_missing'
        : `invalid_${String(issue.expected)}`;
    case 'invalid_value':
      return 'invalid_enum_value';
    case 'too_big':
      return issue.origin === 'array' ? 'too_many_items' : 'value_too_long';
    case 'too_small':
      return issue.origin === 'array' ? 'required_field_missing' : 'value_too_short';
    case 'invalid_format':
      return issue.format === 'uuid' ? 'invalid_uuid' : 'invalid_format';
    default:
      return 'invalid_value';
  }
}
