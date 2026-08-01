import { sql } from 'drizzle-orm';
import { keyringFromEnv } from '@mlain/contracts/keyring';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import { revokePendingMessages } from '../campaigns-port';
import { normalizeEmail } from '../email';
import { computeAllFingerprints } from '../fingerprint';
import { normalizeNameKey } from '../naming/normalize';
import { resolveName } from '../naming/resolve';
import type { Gender, NameOverrideLookup } from '../naming/types';
import { readContactsSettings } from '../settings';
import type { ContactStatus, UpsertMode } from '../types';
import { applyWriteRules } from '../write';
import { byteaArrayLiteral } from './bytea';
import { checkSuppression } from './suppressions';

export type { UpsertMode };

export type ContactUpsertRow = {
  email: string;
  emailFingerprints?: Buffer[];
  firstName?: string | null;
  lastName?: string | null;
  middleName?: string | null;
  titlePrefix?: string | null;
  titleSuffix?: string | null;
  firstNameKey?: string | null;
  lastNameKey?: string | null;
  searchKey?: string | null;
  status?: ContactStatus;
  externalId?: string | null;
  gender?: Gender;
  genderSource?: string;
  firstNameVocative?: string | null;
  lastNameVocative?: string | null;
  vocativeConfidence?: 'high' | 'low' | 'none';
  greeting?: string;
  greetingNeutral?: string;
  nameSplitConfidence?: 'high' | 'low' | 'none';
  attributes: Record<string, unknown>;
  locale?: string;
  source?: string;
  sourceRef?: string | null;
};

export type UpsertResult = { id: string; inserted: boolean };

/**
 * Dávkový upsert kontaktů. Jediné VEŘEJNÉ místo v produktu, kde kontakt vzniká nebo se
 * mění hromadně; všechny čtyři kanály (API, formulář, webhook, import) jdou přes něj.
 *
 * Dávka se zapisuje JEDNÍM příkazem přes unnest, ne tisícem samostatných INSERT.
 * Při dávce 1 000 řádků je rozdíl mezi jedním round-tripem a tisícem.
 *
 * PRAVIDLO 4 SE VYNUCUJE TADY, ne až ve `writeContact`. Kdyby se kontrolovalo jen tam,
 * stačilo by zavolat dávkovou cestu (což dělá import) a člověk, který podal stížnost nebo
 * uplatnil právo na výmaz, by se do databáze vrátil. Vrácené pole proto obsahuje jen
 * SKUTEČNĚ zapsané řádky; potlačené v něm nejsou a volající je pozná podle počtu.
 */
export async function upsertContacts(
  ctx: WorkspaceContext,
  input: { mode: UpsertMode; rows: readonly ContactUpsertRow[] },
): Promise<UpsertResult[]> {
  if (input.rows.length === 0) return [];

  const suppressed = await checkSuppression(
    ctx,
    input.rows.map((row) => row.email),
  );
  const allowed =
    suppressed.size === 0
      ? input.rows
      : input.rows.filter((row) => {
          const parsed = normalizeEmail(row.email);
          if (!parsed.ok) return true;
          const hit = suppressed.get(parsed.email);
          return hit === undefined || !HARD_BLOCK_REASONS.includes(hit.reason);
        });
  if (allowed.length === 0) return [];

  return withWorkspace(ctx, (tx) => upsertRows(tx, ctx, { mode: input.mode, rows: allowed }));
}

/**
 * Důvody, u kterých se kontakt nezapisuje vůbec. Táž dvojice jako v `write.ts`; je tu
 * podruhé schválně, aby dávková cesta nezávisela na tom, že ji volající proženil pravidly.
 */
const HARD_BLOCK_REASONS: readonly string[] = ['complaint', 'gdpr_erasure'];

/**
 * Táž operace uvnitř už otevřené transakce. NENÍ exportovaná: jediná veřejná dávková
 * cesta je `upsertContacts`, která nad ní vynucuje pravidlo 4. Kdyby šla obejít, byla by
 * z pravidla nezávazná rada.
 */
async function upsertRows(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { mode: UpsertMode; rows: readonly ContactUpsertRow[] },
): Promise<UpsertResult[]> {
  if (input.rows.length === 0) return [];

  const rows = input.rows;
  const overwrite = input.mode === 'overwrite';
  // Režim `create` nemá existující kontakt měnit, což je z hlediska aktualizace totéž
  // jako `skip`. Liší se až v tom, co hlásí volajícímu, a to řeší vrstva nad ním.
  const skip = input.mode === 'skip' || input.mode === 'create';

  const { rows: written } = await tx.execute<UpsertResult>(sql`
      INSERT INTO contacts (
        workspace_id, email, email_fingerprints,
        first_name, last_name, middle_name, title_prefix, title_suffix,
        first_name_key, last_name_key, search_key, status, external_id,
        gender, gender_source, first_name_vocative, last_name_vocative,
        vocative_confidence, greeting, greeting_neutral, name_split_confidence,
        attributes, locale, source, source_ref, created_at, updated_at
      )
      SELECT
        ${ctx.workspaceId}::uuid, u.email, u.fingerprints::bytea[],
        u.first_name, u.last_name, u.middle_name, u.title_prefix, u.title_suffix,
        u.first_name_key, u.last_name_key, u.search_key, u.status, u.external_id,
        u.gender, u.gender_source, u.first_name_vocative, u.last_name_vocative,
        u.vocative_confidence, u.greeting, u.greeting_neutral, u.name_split_confidence,
        u.attributes, u.locale, u.source, u.source_ref, now(), now()
      FROM unnest(
        ${sql.param(rows.map((r) => r.email))}::citext[],
        ${sql.param(rows.map((r) => byteaArrayLiteral(r.emailFingerprints ?? [])))}::text[],
        ${sql.param(rows.map((r) => r.firstName ?? null))}::text[],
        ${sql.param(rows.map((r) => r.lastName ?? null))}::text[],
        ${sql.param(rows.map((r) => r.middleName ?? null))}::text[],
        ${sql.param(rows.map((r) => r.titlePrefix ?? null))}::text[],
        ${sql.param(rows.map((r) => r.titleSuffix ?? null))}::text[],
        ${sql.param(rows.map((r) => r.firstNameKey ?? null))}::text[],
        ${sql.param(rows.map((r) => r.lastNameKey ?? null))}::text[],
        ${sql.param(rows.map((r) => r.searchKey ?? null))}::text[],
        ${sql.param(rows.map((r) => r.status ?? 'unconfirmed'))}::text[],
        ${sql.param(rows.map((r) => r.externalId ?? null))}::text[],
        ${sql.param(rows.map((r) => r.gender ?? 'unknown'))}::text[],
        ${sql.param(rows.map((r) => r.genderSource ?? 'none'))}::text[],
        ${sql.param(rows.map((r) => r.firstNameVocative ?? null))}::text[],
        ${sql.param(rows.map((r) => r.lastNameVocative ?? null))}::text[],
        ${sql.param(rows.map((r) => r.vocativeConfidence ?? 'none'))}::text[],
        ${sql.param(rows.map((r) => r.greeting ?? ''))}::text[],
        ${sql.param(rows.map((r) => r.greetingNeutral ?? ''))}::text[],
        ${sql.param(rows.map((r) => r.nameSplitConfidence ?? 'none'))}::text[],
        ${sql.param(rows.map((r) => JSON.stringify(r.attributes)))}::jsonb[],
        ${sql.param(rows.map((r) => r.locale ?? 'cs'))}::text[],
        ${sql.param(rows.map((r) => r.source ?? 'api'))}::text[],
        ${sql.param(rows.map((r) => r.sourceRef ?? null))}::text[]
      ) AS u(
        email, fingerprints, first_name, last_name, middle_name, title_prefix, title_suffix,
        first_name_key, last_name_key, search_key, status, external_id, gender, gender_source,
        first_name_vocative, last_name_vocative, vocative_confidence,
        greeting, greeting_neutral, name_split_confidence,
        attributes, locale, source, source_ref
      )
      -- Klauzule WHERE deleted_at IS NULL za ON CONFLICT je INFERENCE ČÁSTEČNÉHO INDEXU,
      -- ne filtr. PostgreSQL podle ní pozná, že arbitrem konfliktu je částečný index
      -- uq_contacts__workspace_email. Bez ní příkaz skončí chybou 42P10
      -- "no unique or exclusion constraint matching the ON CONFLICT specification".
      ON CONFLICT (workspace_id, email) WHERE deleted_at IS NULL
      DO UPDATE SET
        first_name = CASE
          WHEN ${skip} THEN contacts.first_name
          WHEN ${overwrite} THEN excluded.first_name
          ELSE coalesce(nullif(excluded.first_name, ''), contacts.first_name) END,
        last_name = CASE
          WHEN ${skip} THEN contacts.last_name
          WHEN ${overwrite} THEN excluded.last_name
          ELSE coalesce(nullif(excluded.last_name, ''), contacts.last_name) END,
        middle_name = CASE
          WHEN ${skip} THEN contacts.middle_name
          WHEN ${overwrite} THEN excluded.middle_name
          ELSE coalesce(nullif(excluded.middle_name, ''), contacts.middle_name) END,
        title_prefix = CASE
          WHEN ${skip} THEN contacts.title_prefix
          WHEN ${overwrite} THEN excluded.title_prefix
          ELSE coalesce(nullif(excluded.title_prefix, ''), contacts.title_prefix) END,
        title_suffix = CASE
          WHEN ${skip} THEN contacts.title_suffix
          WHEN ${overwrite} THEN excluded.title_suffix
          ELSE coalesce(nullif(excluded.title_suffix, ''), contacts.title_suffix) END,
        first_name_key = CASE
          WHEN ${skip} THEN contacts.first_name_key
          WHEN ${overwrite} THEN excluded.first_name_key
          ELSE coalesce(excluded.first_name_key, contacts.first_name_key) END,
        last_name_key = CASE
          WHEN ${skip} THEN contacts.last_name_key
          WHEN ${overwrite} THEN excluded.last_name_key
          ELSE coalesce(excluded.last_name_key, contacts.last_name_key) END,
        search_key = CASE
          WHEN ${skip} THEN contacts.search_key
          ELSE coalesce(excluded.search_key, contacts.search_key) END,
        -- PRAVIDLO 3 z úkolu 15, vynucené i tady v SQL. Dřív sloupec status v seznamu
        -- vůbec nebyl, takže se pravidlo v aplikaci spočítalo a zahodilo: nový kontakt
        -- z formuláře s dvojím potvrzením by vznikl rovnou jako 'active', protože to je
        -- výchozí hodnota sloupce v DDL. Přesně tomu má double opt-in bránit.
        --
        -- Povýšení stavu je jednosměrně zakázané: z 'unsubscribed', 'bounced'
        -- a 'complained' se zápisem nikdy nevystoupí. Bez toho by stačilo znovu
        -- naimportovat starý soubor a všichni odhlášení by byli zpátky v rozesílce.
        -- Hodnota 'deleted' mezi zamknutými být nemusí, protože smazaný kontakt
        -- má deleted_at a klauzule WHERE na konci ho z aktualizace vylučuje.
        status = CASE
          WHEN ${skip} THEN contacts.status
          WHEN contacts.status IN ('unsubscribed', 'bounced', 'complained') THEN contacts.status
          ELSE excluded.status END,
        -- Jednou přiřazený identifikátor zákazníka se prázdnou hodnotou nepřepíše:
        -- e-shop, který ho v jednom payloadu nepošle, o vazbu nepřipraví.
        external_id = coalesce(excluded.external_id, contacts.external_id),
        -- Otisky se vždy sjednocují, nikdy nepřepisují: kontakt musí nést otisk pod
        -- každým známým pokolením klíče, jinak by minul suppression řádek zapsaný jiným.
        email_fingerprints = (
          SELECT coalesce(array_agg(DISTINCT f), '{}')
          FROM unnest(contacts.email_fingerprints || excluded.email_fingerprints) AS f
        ),
        gender = CASE
          WHEN ${skip} THEN contacts.gender
          WHEN excluded.gender = 'unknown' AND NOT ${overwrite} THEN contacts.gender
          ELSE excluded.gender END,
        gender_source = CASE
          WHEN ${skip} THEN contacts.gender_source
          WHEN excluded.gender = 'unknown' AND NOT ${overwrite} THEN contacts.gender_source
          ELSE excluded.gender_source END,
        first_name_vocative = CASE
          WHEN ${skip} OR contacts.vocative_locked THEN contacts.first_name_vocative
          ELSE excluded.first_name_vocative END,
        last_name_vocative = CASE
          WHEN ${skip} OR contacts.vocative_locked THEN contacts.last_name_vocative
          ELSE excluded.last_name_vocative END,
        vocative_confidence = CASE
          WHEN ${skip} OR contacts.vocative_locked THEN contacts.vocative_confidence
          ELSE excluded.vocative_confidence END,
        greeting = CASE
          WHEN ${skip} THEN contacts.greeting ELSE excluded.greeting END,
        greeting_neutral = CASE
          WHEN ${skip} THEN contacts.greeting_neutral ELSE excluded.greeting_neutral END,
        name_split_confidence = CASE
          WHEN ${skip} THEN contacts.name_split_confidence
          ELSE excluded.name_split_confidence END,
        -- jsonb_strip_nulls je POVINNÉ, ne kosmetika. Samotné || ponechá klíč s hodnotou
        -- JSON null, takže "vymazání pole" v režimu overwrite by pole nevymazalo:
        -- predikát is_empty by ho vyhodnotil jako neprázdný a uživatel by ho viděl
        -- v segmentu dál. Hodnota JSON null nemá ve attributes žádný legitimní význam,
        -- "nevyplněno" se vyjadřuje nepřítomností klíče. Viz kritérium 49.
        attributes = CASE
          WHEN ${skip} THEN contacts.attributes
          ELSE jsonb_strip_nulls(contacts.attributes || excluded.attributes) END,
        locale = CASE
          WHEN ${skip} THEN contacts.locale ELSE excluded.locale END,
        source_ref = coalesce(excluded.source_ref, contacts.source_ref),
        updated_at = now()
      WHERE contacts.deleted_at IS NULL
      RETURNING id, (xmax = 0) AS inserted;
    `);

  // POZOR: `written` je destrukturované `.rows`, ne návratová hodnota execute().
  // Ovladač node-postgres vrací QueryResult, ne pole; `result[0]` je undefined
  // a tvar `await tx.execute(...) as unknown as UpsertResult[]` by prošel typovou
  // kontrolou i revizí a za běhu vrátil undefined. Viz kapitola 2, past 1.
  return written;
}

export type WriteContactInput = {
  email: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  titlePrefix?: string | null;
  titleSuffix?: string | null;
  gender?: Gender;
  nameOrder?: 'auto' | 'first_last' | 'last_first';
  status?: ContactStatus;
  externalId?: string | null;
  locale?: string;
  source?: string;
  sourceRef?: string | null;
  attributes: Record<string, unknown>;
  mode?: UpsertMode;
};

export type WriteContactResult =
  | { rejected: 'suppressed'; id: null; inserted: false }
  | { rejected: null; id: string; inserted: boolean };

/**
 * Zápis JEDNOHO kontaktu se všemi šesti pravidly a s dopočítaným oslovením.
 *
 * VOKATIV SE POČÍTÁ TADY, PŘI ZÁPISU, ne při odesílání. Sender má hodnoty hotové ve
 * sloupcích a na tabulku kontaktů nesahá; kdyby se počítaly až při rozesílce, platila by
 * se cena za každou zprávu znovu a nejisté případy by nešlo zkontrolovat předem.
 */
export async function writeContact(
  ctx: WorkspaceContext,
  input: WriteContactInput,
): Promise<WriteContactResult> {
  const normalized = normalizeEmail(input.email);
  if (!normalized.ok) {
    throw new ApiError('validation_failed', {
      errors: [{ path: 'email', code: normalized.code, message: 'email is not valid' }],
    });
  }
  const email = normalized.email;

  const suppressed = (await checkSuppression(ctx, [email])).get(email) ?? null;

  return withWorkspace(ctx, async (tx) => {
    const existing = await loadExisting(tx, ctx, email);

    const decision = applyWriteRules({
      existing,
      incoming: {
        email,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
        ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
      },
      mode: input.mode ?? 'update',
      suppression: suppressed === null ? null : { reason: suppressed.reason },
    });

    if (decision.rejected === 'suppressed') {
      return { rejected: 'suppressed', id: null, inserted: false };
    }

    const settings = await readContactsSettings(tx, ctx);
    const workspace = await loadWorkspaceDefaults(tx, ctx);
    const locale = input.locale ?? workspace.locale;

    const name = resolveName(
      {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
        ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
        ...(input.titlePrefix === undefined ? {} : { titlePrefix: input.titlePrefix }),
        ...(input.titleSuffix === undefined ? {} : { titleSuffix: input.titleSuffix }),
        ...(input.gender === undefined ? {} : { gender: input.gender }),
        ...(input.nameOrder === undefined ? {} : { nameOrder: input.nameOrder }),
        locale,
      },
      {
        overrides: await loadOverrides(tx, ctx, input),
        settings: {
          addressForm: workspace.addressForm,
          salutationBy: settings.salutation_by,
          vocativePolicy: settings.vocative_policy,
        },
      },
    );

    // Pravidlo 6: uvolnění zámku vokativu se zapisuje ZVLÁŠŤ a před upsertem, protože
    // upsert sám zamknutou hodnotu z principu nepřepisuje.
    if (decision.releaseVocativeLock) {
      await tx.execute(sql`
        UPDATE contacts SET vocative_locked = false, updated_at = now()
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}::citext
           AND deleted_at IS NULL
      `);
      await writeAudit(tx, ctx, {
        action: 'contact.vocative_lock_released',
        targetType: 'contact',
        targetId: null,
        metadata: { reason: 'name_changed' },
      });
    }

    const fingerprints = computeAllFingerprints(keyringFromEnv(), email);
    const searchKey = normalizeNameKey(
      [email, name.firstName ?? '', name.lastName ?? ''].join(' ').trim(),
    );

    const [written] = await upsertRows(tx, ctx, {
      mode: input.mode ?? 'update',
      rows: [
        {
          email,
          emailFingerprints: fingerprints,
          firstName: name.firstName,
          lastName: name.lastName,
          middleName: name.middleName,
          titlePrefix: name.titlePrefix,
          titleSuffix: name.titleSuffix,
          firstNameKey: name.firstNameKey,
          lastNameKey: name.lastNameKey,
          searchKey,
          status: decision.status,
          externalId: input.externalId ?? null,
          gender: name.gender,
          genderSource: name.genderSource,
          firstNameVocative: name.firstNameVocative,
          lastNameVocative: name.lastNameVocative,
          vocativeConfidence: name.vocativeConfidence,
          greeting: name.greeting,
          greetingNeutral: name.greetingNeutral,
          nameSplitConfidence: name.nameSplitConfidence,
          attributes: input.attributes,
          locale,
          source: input.source ?? 'api',
          sourceRef: input.sourceRef ?? null,
        },
      ],
    });

    if (written === undefined) {
      // Nastane jen v režimu skip nad kontaktem, kterého se aktualizace netýká.
      const again = await loadExisting(tx, ctx, email);
      if (again === null) throw new ApiError('internal_error', {});
      const { rows } = await tx.execute<{ id: string }>(sql`
        SELECT id FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}::citext
           AND deleted_at IS NULL
      `);
      return { rejected: null, id: rows[0]!.id, inserted: false };
    }

    await writeAudit(tx, ctx, {
      action: written.inserted ? 'contact.created' : 'contact.updated',
      targetType: 'contact',
      targetId: written.id,
      metadata: { source: input.source ?? 'api' },
    });

    return { rejected: null, id: written.id, inserted: written.inserted };
  });
}

async function loadExisting(
  tx: Tx,
  ctx: WorkspaceContext,
  email: string,
): Promise<{
  email: string;
  status: ContactStatus;
  vocativeLocked: boolean;
  firstName: string | null;
  lastName: string | null;
} | null> {
  const { rows } = await tx.execute<{
    email: string;
    status: ContactStatus;
    vocative_locked: boolean;
    first_name: string | null;
    last_name: string | null;
  }>(sql`
    SELECT email::text AS email, status, vocative_locked, first_name, last_name
      FROM contacts
     WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}::citext
       AND deleted_at IS NULL
  `);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    email: row.email,
    status: row.status,
    vocativeLocked: row.vocative_locked,
    firstName: row.first_name,
    lastName: row.last_name,
  };
}

async function loadWorkspaceDefaults(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<{ locale: string; addressForm: 'formal' | 'informal' }> {
  const { rows } = await tx.execute<{ locale: string; address_form: 'formal' | 'informal' }>(sql`
    SELECT locale, address_form FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
  `);
  const row = rows[0];
  return { locale: row?.locale ?? 'cs', addressForm: row?.address_form ?? 'formal' };
}

/**
 * Přepisy projektu pro klíče, kterých se zápis týká. Načítají se jen ty dva, ne celá
 * tabulka: u projektu s deseti tisíci přepisy by se jinak při každém zápisu kontaktu
 * stahoval celý slovník.
 */
async function loadOverrides(
  tx: Tx,
  ctx: WorkspaceContext,
  input: WriteContactInput,
): Promise<NameOverrideLookup> {
  const candidates = new Set<string>();
  for (const value of [input.firstName, input.lastName, input.fullName]) {
    if (value === null || value === undefined) continue;
    for (const part of value.split(/\s+/)) {
      const key = normalizeNameKey(part);
      if (key.length > 0) candidates.add(key);
    }
  }
  if (candidates.size === 0) return { find: () => undefined };

  const { rows } = await tx.execute<{
    kind: 'first' | 'last';
    name_key: string;
    gender: Gender | null;
    vocative: string | null;
  }>(sql`
    SELECT kind, name_key, gender, vocative FROM name_overrides
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND name_key = ANY(${sql.param([...candidates])}::text[])
  `);

  const map = new Map<string, { gender?: Gender; vocative?: string }>();
  for (const row of rows) {
    map.set(`${row.kind}:${row.name_key}`, {
      ...(row.gender === null ? {} : { gender: row.gender }),
      ...(row.vocative === null ? {} : { vocative: row.vocative }),
    });
  }
  return { find: (kind, nameKey) => map.get(`${kind}:${nameKey}`) };
}

export type DeleteMode = 'soft' | 'anonymize' | 'purge';

/**
 * Mazání kontaktu podle tabulky ve 4.1.5 části 2.
 *
 * soft:      deleted_at, status deleted, adresa zůstane, do 30 dnů jde obnovit
 * anonymize: plná anonymizace podle 4.14.4, řeší ji job gdpr.erase (úkol 40)
 * purge:     fyzické smazání řádku a kaskád, jen vlastník projektu
 */
export async function deleteContact(
  ctx: WorkspaceContext,
  contactId: string,
  mode: DeleteMode,
): Promise<void> {
  if (mode === 'purge') {
    await withWorkspace(ctx, async (tx) => {
      await tx.execute(sql`
        DELETE FROM contacts WHERE id = ${contactId} AND workspace_id = ${ctx.workspaceId}::uuid
      `);
      await writeAudit(tx, ctx, {
        action: 'contact.purged',
        targetType: 'contact',
        targetId: contactId,
        metadata: {},
      });
    });
    return;
  }

  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE contacts
         SET deleted_at = now(), status = 'deleted', updated_at = now()
       WHERE id = ${contactId}
         AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);
    await writeAudit(tx, ctx, {
      action: 'contact.deleted',
      targetType: 'contact',
      targetId: contactId,
      metadata: { mode },
    });
  });
}

/**
 * Obnova měkce smazaného kontaktu.
 *
 * Kontrola proti živému kontaktu se stejnou adresou je POVINNÁ. Částečný unikátní index
 * ji nezachytí, protože v okamžiku obnovy byl splněný: měkce smazaný řádek do indexu
 * nezasahuje. Bez téhle kontroly by obnova vyrobila dva živé řádky se stejnou adresou
 * a nikdo by to nepoznal, dokud by se jeden z nich neztratil při materializaci publika.
 *
 * Zámek FOR UPDATE nad případným živým řádkem zajistí, že dvě souběžné obnovy
 * nemohou závod vyhrát obě.
 */
export async function restoreContact(ctx: WorkspaceContext, contactId: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const target = await tx.execute<{ id: string; email: string }>(sql`
      SELECT id, email::text AS email FROM contacts
       WHERE id = ${contactId} AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NOT NULL
       FOR UPDATE
    `);
    if (target.rows.length === 0) throw new ApiError('not_found');

    const email = target.rows[0]!.email;

    // Zámek nad KLÍČEM adresy, ne jen nad nalezenými řádky. Kdyby se zamykaly jen živé
    // řádky, dvě souběžné obnovy dvou různých smazaných kontaktů se stejnou adresou by
    // obě neviděly nic a obě by uspěly. Poradní zámek nad (workspace, email) je serializuje.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${ctx.workspaceId}::text || ':' || lower(${email}), 0))
    `);

    const live = await tx.execute<{ id: string }>(sql`
      SELECT id FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}::citext
         AND deleted_at IS NULL
       FOR UPDATE
    `);
    if (live.rows.length > 0) {
      throw new ApiError('already_exists', {
        params: {
          detail: 'email_taken_by_live_contact',
          // id živého kontaktu jde do odpovědi, aby UI mohlo nabídnout sloučení
          conflicting_contact_id: live.rows[0]!.id,
        },
      });
    }

    await tx.execute(sql`
      UPDATE contacts
         SET deleted_at = NULL, status = 'unconfirmed', updated_at = now()
       WHERE id = ${contactId} AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    await writeAudit(tx, ctx, {
      action: 'contact.restored',
      targetType: 'contact',
      targetId: contactId,
      metadata: {},
    });
  });
}

/**
 * Změna adresy kontaktu. E-mail je klíč, takže se nikdy nemění běžným zápisem
 * (pravidlo 1 ze 4.1.2) a tahle operace je jediná cesta.
 *
 * Otisky se přepočítají celé, protože se váží na novou adresu. Otisky staré adresy
 * se zahazují: kontakt existuje dál a jeho ochranu proti vzkříšení neřešíme, ta je
 * vyhrazená vymazaným lidem.
 */
export async function changeContactEmail(
  ctx: WorkspaceContext,
  contactId: string,
  newEmail: string,
): Promise<void> {
  const normalized = normalizeEmail(newEmail);
  if (!normalized.ok) {
    throw new ApiError('validation_failed', {
      errors: [{ path: 'email', code: normalized.code, message: 'email is not valid' }],
    });
  }

  const suppression = await checkSuppression(ctx, [normalized.email]);
  const blocking = suppression.get(normalized.email);
  if (blocking !== undefined && ['complaint', 'gdpr_erasure'].includes(blocking.reason)) {
    throw new ApiError('conflict', { params: { detail: 'contact_suppressed' } });
  }

  const fingerprints = computeAllFingerprints(keyringFromEnv(), normalized.email);

  await withWorkspace(ctx, async (tx) => {
    const current = await tx.execute<{
      email: string;
      first_name: string | null;
      last_name: string | null;
    }>(sql`
      SELECT email::text AS email, first_name, last_name FROM contacts
       WHERE id = ${contactId} AND workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL
       FOR UPDATE
    `);
    if (current.rows.length === 0) throw new ApiError('not_found');
    const from = current.rows[0]!.email;

    const taken = await tx.execute<{ id: string }>(sql`
      SELECT id FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${normalized.email}::citext
         AND deleted_at IS NULL AND id <> ${contactId}
    `);
    if (taken.rows.length > 0) {
      throw new ApiError('already_exists', {
        params: {
          detail: 'email_taken_by_live_contact',
          conflicting_contact_id: taken.rows[0]!.id,
        },
      });
    }

    const searchKey = normalizeNameKey(
      [normalized.email, current.rows[0]!.first_name ?? '', current.rows[0]!.last_name ?? '']
        .join(' ')
        .trim(),
    );

    await tx.execute(sql`
      UPDATE contacts
         SET email = ${normalized.email}::citext,
             email_fingerprints = ${byteaArrayLiteral(fingerprints)}::bytea[],
             search_key = ${searchKey},
             updated_at = now()
       WHERE id = ${contactId} AND workspace_id = ${ctx.workspaceId}::uuid
    `);

    await writeAudit(tx, ctx, {
      action: 'contact.email_changed',
      targetType: 'contact',
      targetId: contactId,
      metadata: { from, to: normalized.email },
    });
  });
}

/**
 * Kontakty, na které se v daném kontextu smí poslat.
 *
 * Dotaz je SQL podobou brány z `mailable.ts` a drží její pořadí vrstev. Jsou to dvě
 * implementace téhož pravidla schválně: brána rozhoduje o jednom kontaktu (náhled,
 * testovací odeslání), dotaz staví publikum. Že se neliší, hlídá test kritéria 48.
 */
export async function listMailableContacts(
  ctx: WorkspaceContext,
  options: { listId?: string },
): Promise<{ id: string; email: string }[]> {
  return withWorkspace(ctx, async (tx) => {
    const listId = options.listId ?? null;
    const { rows } = await tx.execute<{ id: string; email: string }>(sql`
      SELECT c.id, c.email::text AS email
        FROM contacts c
        LEFT JOIN list_subscriptions s
          ON ${listId}::uuid IS NOT NULL
         AND s.contact_id = c.id
         AND s.list_id = ${listId}::uuid
         AND s.workspace_id = c.workspace_id
       WHERE c.workspace_id = ${ctx.workspaceId}::uuid
         AND c.deleted_at IS NULL
         AND c.processing_restricted = false
         AND NOT EXISTS (
           SELECT 1 FROM suppressions sup
            WHERE sup.workspace_id = c.workspace_id
              AND sup.removed_at IS NULL
              AND (sup.email = c.email OR sup.fingerprint = ANY(c.email_fingerprints))
         )
         AND CASE
               WHEN ${listId}::uuid IS NULL THEN c.status = 'active'
               ELSE s.status = 'confirmed'
                AND (s.snooze_until IS NULL OR s.snooze_until <= now())
             END
       ORDER BY c.id
    `);
    return rows;
  });
}

/**
 * Najde kontakt podle identifikátoru zákazníka z e-shopu.
 *
 * Opírá se o částečný unikátní index `uq_contacts__ws_external_id`, který P03 zavedl
 * rozhodnutím R6 a který do téhle opravy neměl v produktu žádného zapisovatele ani
 * čtenáře. Vrací `null`, ne výjimku: příchozí webhook s neznámým identifikátorem
 * zakládá nový kontakt, což je běžný, ne chybový stav.
 */
export async function findByExternalId(
  ctx: WorkspaceContext,
  externalId: string,
): Promise<{ id: string; email: string } | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string; email: string }>(sql`
      SELECT id, email::text AS email FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND external_id = ${externalId}
         AND deleted_at IS NULL
    `);
    return rows[0] ?? null;
  });
}

/** Viditelné kontakty projektu. Smazané v seznamu nejsou nikdy. */
export async function listVisibleContacts(
  ctx: WorkspaceContext,
): Promise<{ id: string; email: string; status: string }[]> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string; email: string; status: string }>(sql`
      SELECT id, email::text AS email, status FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
    `);
    return rows;
  });
}

/**
 * Omezení zpracování podle článku 18. Nic se nemaže, jen se nezpracovává.
 *
 * Kompilátor segmentů takový kontakt vždy vyloučí a materializace publika ho nesmí
 * zařadit. Uživatel by jinak nikdy nezjistil, proč se počet nesejde, takže to detail
 * kontaktu vysvětluje samostatným blokem a rozpad publika kampaně samostatným
 * odečtovým řádkem, ne schované v "ostatní".
 *
 * Přidáno úkolem 42 plánu P07.
 */
export async function restrictProcessing(
  ctx: WorkspaceContext,
  contactId: string,
  requestId?: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      UPDATE contacts SET processing_restricted = true, updated_at = now()
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL AND processing_restricted = false
      RETURNING id
    `);
    if (result.rows.length === 0) return;

    await revokePendingMessages({
      workspaceId: ctx.workspaceId,
      contactIds: [contactId],
      listId: null,
      reason: 'processing_restricted',
    });

    await writeAudit(tx, ctx, {
      action: 'contact.processing_restricted',
      targetType: 'contact',
      targetId: contactId,
      metadata: requestId === undefined ? {} : { gdpr_request_id: requestId },
    });
  });
}

/**
 * Zrušit omezení smí jen správce, protože to znamená vrátit kontakt do rozesílky.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ MATICÍ ROLÍ. Plán žádal `contacts:delete`. To je
 * v matici P04 (`packages/core/src/identity/permissions.ts`) oprávnění EDITORA, takže
 * by kontrola neomezila nikoho a věta "smí jen správce" by byla nepravdivá. Použije se
 * proto `suppressions:write`, tedy nejbližší oprávnění na úrovni admina; zrušení omezení
 * podle článku 18 je svou vahou totéž jako odblokování adresy.
 */
export async function liftProcessingRestriction(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<void> {
  assertPermission(ctx, 'suppressions:write');

  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE contacts SET processing_restricted = false, updated_at = now()
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    await writeAudit(tx, ctx, {
      action: 'contact.processing_restriction_lifted',
      targetType: 'contact',
      targetId: contactId,
      metadata: {},
    });
  });
}
