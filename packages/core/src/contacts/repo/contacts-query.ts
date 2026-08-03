import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import { normalizeNameKey } from '../naming/normalize';
import { toIso, toIsoRequired, type ContactResponse } from '../api/schemas';

/**
 * Čtecí strana kontaktů pro REST API.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán psal handlery proti funkcím
 * `contactsRepo.list/count/getById/findByEmail`, které v repozitáři neexistují:
 * `repo/contacts.ts` vlastní jen ZÁPIS (upsert, write, delete, restore, change email).
 * Čtení tedy vzniká tady, ve vlastním souboru, aby se zapisovací modul nezvětšoval
 * o dotazy, které s pravidly zápisu nemají nic společného.
 *
 * Dotaz skládá celou odpověď JEDNÍM příkazem, včetně štítků, seznamů, souhlasů
 * a suppression. Postupné doptávání by u stránky s 50 kontakty znamenalo 201 dotazů.
 */

export type ContactListQuery = {
  limit: number;
  cursor?: string | undefined;
  order: string;
  q?: string | undefined;
  status?: string | undefined;
  list_id?: string | undefined;
  tag_id?: string | undefined;
  segment_id?: string | undefined;
  created_after?: string | undefined;
  created_before?: string | undefined;
  vocative_confidence?: string | undefined;
};

export type ContactPage = {
  rows: ContactResponse[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
};

export type ContactCount = {
  count: number;
  precision: 'exact' | 'estimated';
  computedAt: Date;
  stale: boolean;
};

/**
 * Řadicí klíče a jejich SQL výraz. Každý má krycí index (viz DDL tabulky contacts),
 * proto se sem nedá přidat hodnota volným textem: seřazení pěti milionů řádků bez
 * indexu je rozdíl mezi milisekundami a minutou.
 */
const ORDERS: Record<string, { expr: SQL; direction: 'asc' | 'desc' }> = {
  'created_at.desc': { expr: sql`c.created_at`, direction: 'desc' },
  'created_at.asc': { expr: sql`c.created_at`, direction: 'asc' },
  'updated_at.desc': { expr: sql`c.updated_at`, direction: 'desc' },
  // Sloupec je nullable, takže se pro keyset normalizuje na -infinity. Bez toho
  // by kurzor přes hranici NULL hodnot přeskočil nebo zopakoval řádky.
  'last_activity_at.desc': {
    expr: sql`coalesce(c.last_activity_at, '-infinity'::timestamptz)`,
    direction: 'desc',
  },
};

/** Kurzor je neprůhledný pro klienta, ale musí být stabilní: hodnota řazení a id. */
function encodeCursor(value: string, id: string): string {
  return Buffer.from(`${value}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { value: string; id: string } | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) return null;
  return { value: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
}

/** Sloupce a agregáty, ze kterých se skládá ContactResponse. */
const CONTACT_SELECT = sql`
  c.id, c.email::text AS email, c.status, c.first_name, c.last_name, c.middle_name,
  c.title_prefix, c.title_suffix, c.gender, c.gender_source,
  c.first_name_vocative, c.last_name_vocative, c.vocative_confidence, c.vocative_locked,
  c.greeting, c.locale, c.attributes, c.processing_restricted, c.source,
  c.created_at, c.updated_at, c.last_activity_at,
  coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY lower(t.name))
      FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.contact_id = c.id AND ct.workspace_id = c.workspace_id
  ), '[]'::jsonb) AS tags,
  coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'list_id', ls.list_id, 'name', l.name, 'status', ls.status,
             'subscribed_at', ls.subscribed_at, 'confirmed_at', ls.confirmed_at,
             'snooze_until', ls.snooze_until) ORDER BY l.name)
      FROM list_subscriptions ls JOIN lists l ON l.id = ls.list_id
     WHERE ls.contact_id = c.id AND ls.workspace_id = c.workspace_id
  ), '[]'::jsonb) AS lists,
  coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'purpose', s.purpose, 'status', s.status,
             'legal_basis', s.legal_basis, 'since', s.since) ORDER BY s.purpose)
      FROM contact_consent_state s
     WHERE s.contact_id = c.id AND s.workspace_id = c.workspace_id
  ), '[]'::jsonb) AS consents,
  (
    SELECT jsonb_build_object('reason', sup.reason, 'created_at', sup.created_at)
      FROM suppressions sup
     WHERE sup.workspace_id = c.workspace_id AND sup.email = c.email
       AND sup.removed_at IS NULL
     LIMIT 1
  ) AS suppression
`;

type ContactRow = {
  id: string;
  email: string;
  status: ContactResponse['status'];
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  title_prefix: string | null;
  title_suffix: string | null;
  gender: ContactResponse['gender'];
  gender_source: string;
  first_name_vocative: string | null;
  last_name_vocative: string | null;
  vocative_confidence: ContactResponse['vocative_confidence'];
  vocative_locked: boolean;
  greeting: string;
  locale: string;
  attributes: Record<string, unknown>;
  processing_restricted: boolean;
  source: string;
  created_at: string | Date;
  updated_at: string | Date;
  last_activity_at: string | Date | null;
  tags: { id: string; name: string }[];
  lists: {
    list_id: string;
    name: string;
    status: string;
    subscribed_at: string;
    confirmed_at: string | null;
    snooze_until: string | null;
  }[];
  consents: { purpose: string; status: string; legal_basis: string; since: string }[];
  suppression: { reason: string; created_at: string } | null;
  sort_value?: string | Date;
};

function toContact(row: ContactRow): ContactResponse {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    first_name: row.first_name,
    last_name: row.last_name,
    middle_name: row.middle_name,
    title_prefix: row.title_prefix,
    title_suffix: row.title_suffix,
    gender: row.gender,
    gender_source: row.gender_source,
    first_name_vocative: row.first_name_vocative,
    last_name_vocative: row.last_name_vocative,
    vocative_confidence: row.vocative_confidence,
    vocative_locked: row.vocative_locked,
    greeting: row.greeting,
    locale: row.locale,
    attributes: row.attributes,
    tags: row.tags,
    lists: row.lists.map((item) => ({
      list_id: item.list_id,
      name: item.name,
      status: item.status,
      subscribed_at: toIsoRequired(item.subscribed_at),
      confirmed_at: toIso(item.confirmed_at),
      snooze_until: toIso(item.snooze_until),
    })),
    consents: row.consents.map((item) => ({
      purpose: item.purpose,
      status: item.status,
      legal_basis: item.legal_basis,
      since: toIsoRequired(item.since),
    })),
    suppression:
      row.suppression === null
        ? null
        : { reason: row.suppression.reason, created_at: toIsoRequired(row.suppression.created_at) },
    processing_restricted: row.processing_restricted,
    source: row.source,
    created_at: toIsoRequired(row.created_at),
    updated_at: toIsoRequired(row.updated_at),
    last_activity_at: toIso(row.last_activity_at),
  };
}

/**
 * Podmínky filtru. Hledání jde přes `search_key`, tedy sloupec bez diakritiky plněný
 * aplikací, a přes e-mail. Obě strany porovnání prošly toutéž funkcí, takže "novak"
 * najde "Novák" i naopak (rozhodnutí R12).
 */
function filters(ctx: WorkspaceContext, query: ContactListQuery): SQL[] {
  const conditions: SQL[] = [
    sql`c.workspace_id = ${ctx.workspaceId}::uuid`,
    sql`c.deleted_at IS NULL`,
  ];

  if (query.q !== undefined && query.q.trim() !== '') {
    const key = normalizeNameKey(query.q);
    const raw = query.q.toLowerCase();
    conditions.push(sql`(c.search_key LIKE ${`%${key}%`} OR c.email::text LIKE ${`%${raw}%`})`);
  }
  if (query.status !== undefined) conditions.push(sql`c.status = ${query.status}`);
  if (query.vocative_confidence !== undefined) {
    conditions.push(sql`c.vocative_confidence = ${query.vocative_confidence}`);
  }
  if (query.created_after !== undefined) {
    conditions.push(sql`c.created_at >= ${query.created_after}::timestamptz`);
  }
  if (query.created_before !== undefined) {
    conditions.push(sql`c.created_at < ${query.created_before}::timestamptz`);
  }
  if (query.list_id !== undefined) {
    conditions.push(sql`EXISTS (SELECT 1 FROM list_subscriptions ls
       WHERE ls.contact_id = c.id AND ls.workspace_id = c.workspace_id
         AND ls.list_id = ${query.list_id}::uuid)`);
  }
  if (query.tag_id !== undefined) {
    conditions.push(sql`EXISTS (SELECT 1 FROM contact_tags ct
       WHERE ct.contact_id = c.id AND ct.workspace_id = c.workspace_id
         AND ct.tag_id = ${query.tag_id}::uuid)`);
  }
  if (query.segment_id !== undefined) {
    // Materializaci segmentů vlastní P11. Tenhle plán jen čte hotovou tabulku;
    // prázdný segment tedy vrátí prázdnou stránku, ne chybu.
    conditions.push(sql`EXISTS (SELECT 1 FROM segment_members sm
       WHERE sm.contact_id = c.id AND sm.workspace_id = c.workspace_id
         AND sm.segment_id = ${query.segment_id}::uuid)`);
  }
  return conditions;
}

/** Filtr bez stránkování, tedy to, co popisuje MNOŽINU kontaktů, ne jednu její stránku. */
export type ContactBulkFilter = Omit<ContactListQuery, 'limit' | 'cursor' | 'order'>;

/**
 * Tytéž podmínky filtru pro hromadné operace nad výsledkem filtru (job contacts.bulk_delete).
 *
 * Vystavuje se jedna funkce, ne druhá kopie skládání WHERE. Kdyby si hromadné mazání
 * stavělo podmínky samo, mazalo by po první změně filtru jinou množinu, než jakou
 * uživatel viděl v seznamu a než jakou mu spočítal `countContacts`. U nevratné operace
 * je to rozdíl mezi "smazalo se to, co jsem vybral" a tichou ztrátou dat.
 */
export function contactFilterConditions(ctx: WorkspaceContext, filter: ContactBulkFilter): SQL[] {
  return filters(ctx, { ...filter, limit: 0, order: 'created_at.desc' });
}

export async function listContacts(
  ctx: WorkspaceContext,
  query: ContactListQuery,
): Promise<ContactPage> {
  const order = ORDERS[query.order] ?? ORDERS['created_at.desc']!;
  const conditions = filters(ctx, query);

  if (query.cursor !== undefined) {
    const decoded = decodeCursor(query.cursor);
    if (decoded !== null) {
      // Keyset, ne OFFSET. Porovnává se dvojice (hodnota řazení, id), aby stránka
      // nepřeskočila řádek vložený mezi dvěma listováními.
      const comparison =
        order.direction === 'desc'
          ? sql`(${order.expr}, c.id) < (${decoded.value}::timestamptz, ${decoded.id}::uuid)`
          : sql`(${order.expr}, c.id) > (${decoded.value}::timestamptz, ${decoded.id}::uuid)`;
      conditions.push(comparison);
    }
  }

  const where = sql.join(conditions, sql` AND `);
  const direction = order.direction === 'desc' ? sql`DESC` : sql`ASC`;

  return withWorkspace(ctx, async (tx) => {
    // Načítá se o řádek víc, než klient chtěl. Je to nejlevnější způsob, jak zjistit
    // has_more bez druhého dotazu s COUNT.
    const { rows } = await tx.execute<ContactRow>(sql`
      SELECT ${CONTACT_SELECT}, ${order.expr} AS sort_value
        FROM contacts c
       WHERE ${where}
       ORDER BY ${order.expr} ${direction}, c.id ${direction}
       LIMIT ${query.limit + 1}
    `);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      rows: page.map(toContact),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor(toIsoRequired(last.sort_value ?? last.created_at), last.id)
          : null,
      // Kurzorové stránkování v tomhle API jede jedním směrem. Zpětný kurzor
      // vlastní obrazovka (drží si historii), server ho nedopočítává.
      prevCursor: null,
      hasMore,
    };
  });
}

/**
 * Počet kontaktů pro tytéž filtry jako seznam.
 *
 * ODCHYLKA OD PLÁNU: vrací se vždy `exact`. Odhad z `pg_class.reltuples` je globální
 * přes celou tabulku, tedy přes všechny projekty naráz, a v multitenantní tabulce by
 * vydal číslo, které s projektem nesouvisí. Než vrátit rychle špatný počet, vrací se
 * pomaleji správný; strop je stejně dotaz omezený indexem na jeden projekt.
 */
export async function countContacts(
  ctx: WorkspaceContext,
  query: Omit<ContactListQuery, 'limit' | 'cursor' | 'order'>,
): Promise<ContactCount> {
  const where = sql.join(
    filters(ctx, { ...query, limit: 0, order: 'created_at.desc' }),
    sql` AND `,
  );
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM contacts c WHERE ${where}
    `);
    return {
      count: rows[0]?.total ?? 0,
      precision: 'exact',
      computedAt: new Date(),
      stale: false,
    };
  });
}

async function selectOne(tx: Tx, where: SQL): Promise<ContactResponse | null> {
  const { rows } = await tx.execute<ContactRow>(sql`
    SELECT ${CONTACT_SELECT} FROM contacts c WHERE ${where} LIMIT 1
  `);
  const row = rows[0];
  return row === undefined ? null : toContact(row);
}

export async function getContactById(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<ContactResponse | null> {
  return withWorkspace(ctx, async (tx) =>
    selectOne(
      tx,
      sql`c.workspace_id = ${ctx.workspaceId}::uuid AND c.id = ${contactId}::uuid
          AND c.deleted_at IS NULL`,
    ),
  );
}

/** Vyhledání podle adresy. Adresa se sem dostává už normalizovaná schématem EmailInput. */
export async function findContactByEmail(
  ctx: WorkspaceContext,
  email: string,
): Promise<ContactResponse | null> {
  return withWorkspace(ctx, async (tx) =>
    selectOne(
      tx,
      sql`c.workspace_id = ${ctx.workspaceId}::uuid AND c.email = ${email}::citext
          AND c.deleted_at IS NULL`,
    ),
  );
}
