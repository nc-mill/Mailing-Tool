import { sql } from 'drizzle-orm';
import { contactExistsForJoinSql } from '../../contacts/existence';
import type { Tx, WorkspaceContext } from '../../tx';
import { TOP_ITEMS_LIMIT } from './attribution';
import type { WebEventRow, WebPageRow } from './campaign';

/**
 * Přehled toho, co se děje na webu projektu.
 *
 * Odpovídá na čtyři otázky v tomhle pořadí: kdo přišel, odkud, co si prohlédl
 * a co udělal. Ne na otázku „kolik máme relací", protože tu si nikdo neklade.
 *
 * DVĚ SKUPINY NÁVŠTĚVNÍKŮ, a rozdíl mezi nimi je celý produkt:
 *  - známí lidé, u kterých víme, o koho jde, protože se jejich prohlížeč někdy
 *    propojil s kontaktem (proklik z e-mailu, přihlášení),
 *  - neznámí návštěvníci, o kterých víme jen to, že to je pořád tentýž
 *    prohlížeč. Až kliknou v e-mailu, jejich dosavadní historie se k nim
 *    doplní zpětně.
 * Sčítat je do jednoho čísla by smazalo právě tu informaci, kvůli které
 * se na obrazovku někdo dívá.
 */

export const WEB_OVERVIEW_PERIODS = [1, 7, 30] as const;
export type WebOverviewPeriod = (typeof WEB_OVERVIEW_PERIODS)[number];

/** Kolik posledních návštěv se vypíše. Přes dvacet už nikdo nečte. */
const RECENT_VISITS_LIMIT = 20;

export type WebReferrerRow = { host: string; visits: number };

export type WebVisit = {
  /** `null` u návštěvníka, kterého zatím neumíme pojmenovat. */
  contactId: string | null;
  email: string | null;
  name: string | null;
  startedAt: string;
  endedAt: string;
  pageViews: number;
  events: number;
  entryPath: string | null;
  lastPath: string | null;
  referrerHost: string | null;
};

export type WebActivityOverview = {
  periodDays: WebOverviewPeriod;
  computedAt: string;
  knownContacts: number;
  anonymousVisitors: number;
  pageViews: number;
  otherEvents: number;
  /**
   * Dorazilo z webu KDY NAPOSLED, bez ohledu na zvolené období.
   *
   * Rozlišuje dva prázdné stavy, které vypadají stejně a znamenají opak:
   * „za sedm dní nikdo nepřišel" (měření běží) a „nikdy nic nedorazilo"
   * (měřicí značka nejspíš není nasazená). Bez toho obrazovka v obou
   * případech mlčí a uživatel neví, jestli má něco opravovat.
   */
  lastEventAt: string | null;
  pages: WebPageRow[];
  events: WebEventRow[];
  referrers: WebReferrerRow[];
  visits: WebVisit[];
};

const RECEIVED_LEAD_SECONDS = 60;
const RECEIVED_LAG_DAYS = 7;

/**
 * Jeden dotaz nad jedním oknem.
 *
 * Meze na `received_at` jsou POVINNÉ, i když se filtruje a řadí podle
 * `occurred_at`: partiční klíč je `received_at` a bez něj se projdou oddíly
 * celé instalace, tedy i cizí projekty. Rozestup obou časů omezuje
 * `ck_web_events__lag` na sedm dní zpět a minutu dopředu, okno je proto
 * o tuhle rezervu širší.
 *
 * Nad oknem se pak počítá všechno najednou. Pět samostatných dotazů by
 * pětkrát prošlo tytéž řádky a každý by přitom viděl trochu jiný svět.
 */
export async function readWebActivityOverview(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { periodDays: WebOverviewPeriod; now?: Date },
): Promise<WebActivityOverview> {
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - input.periodDays * 24 * 60 * 60 * 1000);
  const receivedFrom = new Date(from.getTime() - RECEIVED_LEAD_SECONDS * 1000);
  const receivedTo = new Date(now.getTime() + RECEIVED_LAG_DAYS * 24 * 60 * 60 * 1000);

  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    WITH events AS (
      SELECT we.id,
             we.name,
             we.occurred_at,
             we.session_id,
             we.anonymous_id,
             -- Smazaný člověk není návštěvník. Události po něm v tabulce
             -- zůstávají a bez téhle podmínky by se vrátil do statistik.
             CASE WHEN we.contact_id IS NOT NULL AND ${sql.raw(contactExistsForJoinSql('we'))}
                  THEN we.contact_id END AS contact_id,
             nullif(we.page->>'path', '') AS path,
             nullif(substring(we.page->>'referrer' from '://([^/?#]+)'), '') AS referrer_host
        FROM web_events we
       WHERE we.workspace_id = ${ctx.workspaceId}
         AND we.source = 'web'
         AND we.erased_at IS NULL
         AND we.occurred_at >= ${from}
         AND we.occurred_at <  ${now}
         AND we.received_at >= ${receivedFrom}
         AND we.received_at <  ${receivedTo}
    ),
    pages AS (
      SELECT path, count(*)::int AS views,
             count(DISTINCT coalesce(contact_id, anonymous_id))::int AS visitors
        FROM events
       WHERE name = 'page_view' AND path IS NOT NULL
       GROUP BY path
       ORDER BY views DESC, path
       LIMIT ${TOP_ITEMS_LIMIT}
    ),
    named AS (
      SELECT name, count(*)::int AS count,
             count(DISTINCT coalesce(contact_id, anonymous_id))::int AS visitors
        FROM events
       WHERE name <> 'page_view'
       GROUP BY name
       ORDER BY count DESC, name
       LIMIT ${TOP_ITEMS_LIMIT}
    ),
    referrers AS (
      SELECT referrer_host AS host, count(*)::int AS visits
        FROM events
       WHERE referrer_host IS NOT NULL
       GROUP BY referrer_host
       ORDER BY visits DESC, host
       LIMIT ${TOP_ITEMS_LIMIT}
    ),
    /*
     * Návštěva = jedna relace jednoho člověka. Události bez session_id
     * (serverové, dávkové) tvoří každá vlastní návštěvu, protože je není
     * podle čeho slučovat; slít je do jedné by vyrobilo návštěvu, která se
     * nikdy nestala.
     */
    grouped AS (
      SELECT coalesce(session_id::text, id::text) AS visit_key,
             -- Kdo relaci prohlížel, se bere ZE VŠECH jejích událostí, ne
             -- z každé zvlášť. Ne každá je stejně vyplněná: sloučená historie
             -- má contact_id a anonymous_id nemusí, serverová naopak. Skupina
             -- podle dvojice by z jedné návštěvy udělala dvě.
             max(contact_id::text)::uuid   AS contact_id,
             max(anonymous_id::text)::uuid AS anonymous_id,
             min(occurred_at) AS started_at,
             max(occurred_at) AS ended_at,
             count(*) FILTER (WHERE name = 'page_view')::int AS page_views,
             count(*)::int AS events,
             (array_agg(path ORDER BY occurred_at ASC) FILTER (WHERE path IS NOT NULL))[1]
               AS entry_path,
             (array_agg(path ORDER BY occurred_at DESC) FILTER (WHERE path IS NOT NULL))[1]
               AS last_path,
             (array_agg(referrer_host ORDER BY occurred_at ASC)
                FILTER (WHERE referrer_host IS NOT NULL))[1] AS referrer_host
        FROM events
       GROUP BY visit_key
       ORDER BY max(occurred_at) DESC
       LIMIT ${RECENT_VISITS_LIMIT}
    ),
    visits AS (
      SELECT g.contact_id,
             ct.email::text AS email,
             nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') AS name,
             g.started_at, g.ended_at, g.page_views, g.events,
             g.entry_path, g.last_path, g.referrer_host
        FROM grouped g
        LEFT JOIN contacts ct
               ON ct.id = g.contact_id AND ct.workspace_id = ${ctx.workspaceId}
       ORDER BY g.ended_at DESC
    )
    SELECT (SELECT count(DISTINCT contact_id)::int FROM events)      AS known_contacts,
           (SELECT count(DISTINCT anonymous_id)::int FROM events
             WHERE contact_id IS NULL)                               AS anonymous_visitors,
           (SELECT count(*)::int FROM events WHERE name = 'page_view')  AS page_views,
           (SELECT count(*)::int FROM events WHERE name <> 'page_view') AS other_events,
           (SELECT coalesce(json_agg(pages), '[]'::json) FROM pages)     AS pages,
           (SELECT coalesce(json_agg(named), '[]'::json) FROM named)     AS events,
           (SELECT coalesce(json_agg(referrers), '[]'::json) FROM referrers) AS referrers,
           (SELECT coalesce(json_agg(visits), '[]'::json) FROM visits)   AS visits
  `);

  const row = rows[0] ?? {};

  return {
    periodDays: input.periodDays,
    computedAt: now.toISOString(),
    knownContacts: Number(row['known_contacts'] ?? 0),
    anonymousVisitors: Number(row['anonymous_visitors'] ?? 0),
    pageViews: Number(row['page_views'] ?? 0),
    otherEvents: Number(row['other_events'] ?? 0),
    lastEventAt: await readLastWebEventAt(tx, ctx, now),
    pages: asArray(row['pages']).map((item) => ({
      path: String(item['path']),
      views: Number(item['views'] ?? 0),
      visitors: Number(item['visitors'] ?? 0),
    })),
    events: asArray(row['events']).map((item) => ({
      name: String(item['name']),
      count: Number(item['count'] ?? 0),
      visitors: Number(item['visitors'] ?? 0),
    })),
    referrers: asArray(row['referrers']).map((item) => ({
      host: String(item['host']),
      visits: Number(item['visits'] ?? 0),
    })),
    visits: asArray(row['visits']).map((item) => ({
      contactId: item['contact_id'] === null ? null : String(item['contact_id']),
      email: item['email'] === null ? null : String(item['email']),
      name: item['name'] === null ? null : String(item['name']),
      startedAt: new Date(item['started_at'] as string).toISOString(),
      endedAt: new Date(item['ended_at'] as string).toISOString(),
      pageViews: Number(item['page_views'] ?? 0),
      events: Number(item['events'] ?? 0),
      entryPath: item['entry_path'] === null ? null : String(item['entry_path']),
      lastPath: item['last_path'] === null ? null : String(item['last_path']),
      referrerHost: item['referrer_host'] === null ? null : String(item['referrer_host']),
    })),
  };
}

/**
 * Kdy naposled dorazila JAKÁKOLIV událost z webu.
 *
 * Vlastní dotaz, protože se ptá mimo zvolené období, a schválně jen do hloubky
 * uchovávání: hledat „někdy v historii" by znamenalo projít všechny oddíly.
 * Když se nic nenajde ani za devadesát dní, je odpověď „nikdy" dost přesná na
 * to, aby obrazovka poradila zkontrolovat nasazení měřicí značky.
 */
const LAST_EVENT_LOOKBACK_DAYS = 90;

async function readLastWebEventAt(
  tx: Tx,
  ctx: WorkspaceContext,
  now: Date,
): Promise<string | null> {
  const from = new Date(now.getTime() - LAST_EVENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT max(occurred_at) AS last_at
      FROM web_events
     WHERE workspace_id = ${ctx.workspaceId}
       AND source = 'web'
       AND erased_at IS NULL
       AND occurred_at >= ${from}
       AND received_at >= ${new Date(from.getTime() - RECEIVED_LEAD_SECONDS * 1000)}
       AND received_at <  ${new Date(now.getTime() + RECEIVED_LAG_DAYS * 24 * 60 * 60 * 1000)}
  `);
  const value = rows[0]?.['last_at'];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}
