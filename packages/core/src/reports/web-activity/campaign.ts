import { sql } from 'drizzle-orm';
import { contactExistsForJoinSql } from '../../contacts/existence';
import type { Tx, WorkspaceContext } from '../../tx';
import { notFound } from '../errors';
import { ATTRIBUTION_WINDOW_HOURS, TOP_ITEMS_LIMIT, VISITOR_SAMPLE_LIMIT } from './attribution';

/**
 * Co lidé dělali na webu po téhle kampani.
 *
 * Pravidlo připsání i jeho meze popisuje {@link './attribution'}. Tady je
 * jenom dotaz, který podle něj počítá.
 */

export type WebPageRow = { path: string; views: number; visitors: number };
export type WebEventRow = { name: string; count: number; visitors: number };

export type CampaignWebVisitor = {
  contactId: string;
  email: string;
  name: string;
  pageViews: number;
  events: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type CampaignWebActivity = {
  campaignId: string;
  /** Kdy se kampaň rozjela. `null` znamená, že se ještě neodeslala. */
  startedAt: string | null;
  windowHours: number;
  /** Kolik lidí v kampani prokazatelně kliklo. Jmenovatel věty „z nich přišlo". */
  clickedContacts: number;
  /** Kolik z nich se v okně objevilo na webu. */
  visitorContacts: number;
  pageViews: number;
  otherEvents: number;
  sessions: number;
  lastVisitAt: string | null;
  pages: WebPageRow[];
  events: WebEventRow[];
  visitors: CampaignWebVisitor[];
};

/**
 * Okno pro `received_at`.
 *
 * `occurred_at` říká, kdy se událost stala, `received_at` kdy dorazila, oddíly
 * se prořezávají podle `received_at` a `ck_web_events__lag` je drží nejvýš sedm
 * dní od sebe (a minutu na druhou stranu, když jdou hodiny klienta napřed).
 * Bez těchhle dvou mezí by se dotaz probíral oddíly celé instalace, ne jen
 * těmi, ve kterých data můžou být.
 */
const RECEIVED_LEAD_SECONDS = 60;
const RECEIVED_LAG_DAYS = 7;

export async function readCampaignWebActivity(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
  now: Date = new Date(),
): Promise<CampaignWebActivity> {
  const { rows: campaignRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id, started_at FROM campaigns
     WHERE workspace_id = ${ctx.workspaceId} AND id = ${campaignId} AND deleted_at IS NULL
  `);
  const campaign = campaignRows[0];
  if (!campaign) throw notFound('campaign');

  const startedAt = asDate(campaign['started_at']);
  const empty: CampaignWebActivity = {
    campaignId,
    startedAt: startedAt?.toISOString() ?? null,
    windowHours: ATTRIBUTION_WINDOW_HOURS,
    clickedContacts: 0,
    visitorContacts: 0,
    pageViews: 0,
    otherEvents: 0,
    sessions: 0,
    lastVisitAt: null,
    pages: [],
    events: [],
    visitors: [],
  };
  // Nerozeslaná kampaň nemá prokliky, takže není co spojovat. Dotaz by vrátil
  // prázdno taky, jen by kvůli tomu prošel dva oddíly navíc.
  if (startedAt === null) return empty;

  const windowEnd = new Date(now.getTime() + ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1000);
  const receivedFrom = new Date(startedAt.getTime() - RECEIVED_LEAD_SECONDS * 1000);
  const receivedTo = new Date(windowEnd.getTime() + RECEIVED_LAG_DAYS * 24 * 60 * 60 * 1000);
  const window = sql.raw(`interval '${ATTRIBUTION_WINDOW_HOURS} hours'`);

  /*
   * Jeden dotaz, ne pět.
   *
   * Souhrn, žebříček stránek, žebříček událostí i jmenný seznam stojí nad TOUŽ
   * množinou návštěv. Kdyby se každý ptal zvlášť, prošel by se oddíl pětkrát
   * a pět odpovědí by přitom mohlo popisovat pět různých okamžiků, protože mezi
   * dotazy pořád přitékají nové události. Panel by pak tvrdil „přišlo 5 lidí"
   * a vypsal jich šest.
   *
   * `clicks` schválně řeší i to, že týž člověk mohl v kampani kliknout
   * několikrát: bere se PRVNÍ proklik, protože od něj se měří okno.
   */
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    WITH clicks AS (
      SELECT we.contact_id, min(we.occurred_at) AS clicked_at
        FROM web_events we
       WHERE we.workspace_id = ${ctx.workspaceId}
         AND we.name = 'email_clicked'
         AND we.source = 'email'
         AND we.contact_id IS NOT NULL
         AND we.erased_at IS NULL
         AND we.properties->>'campaign_id' = ${campaignId}
         AND we.properties->>'click_class' = 'human'
         AND we.occurred_at >= ${startedAt}
         AND we.occurred_at <  ${now}
         AND we.received_at >= ${receivedFrom}
         AND we.received_at <  ${receivedTo}
         AND ${sql.raw(contactExistsForJoinSql('we'))}
       GROUP BY we.contact_id
    ),
    visits AS (
      SELECT we.contact_id,
             we.name,
             we.session_id,
             nullif(we.page->>'path', '') AS path,
             we.occurred_at
        FROM clicks c
        JOIN web_events we
          ON we.workspace_id = ${ctx.workspaceId}
         AND we.contact_id   = c.contact_id
         AND we.occurred_at >= c.clicked_at
         AND we.occurred_at <  c.clicked_at + ${window}
       WHERE we.source = 'web'
         AND we.erased_at IS NULL
         AND we.received_at >= ${receivedFrom}
         AND we.received_at <  ${receivedTo}
    ),
    pages AS (
      SELECT path, count(*)::int AS views, count(DISTINCT contact_id)::int AS visitors
        FROM visits
       WHERE name = 'page_view' AND path IS NOT NULL
       GROUP BY path
       ORDER BY views DESC, path
       LIMIT ${TOP_ITEMS_LIMIT}
    ),
    events AS (
      SELECT name, count(*)::int AS count, count(DISTINCT contact_id)::int AS visitors
        FROM visits
       WHERE name <> 'page_view'
       GROUP BY name
       ORDER BY count DESC, name
       LIMIT ${TOP_ITEMS_LIMIT}
    ),
    visitors AS (
      SELECT v.contact_id,
             ct.email::text AS email,
             trim(concat_ws(' ', ct.first_name, ct.last_name)) AS name,
             count(*) FILTER (WHERE v.name = 'page_view')::int AS page_views,
             count(*)::int AS events,
             min(v.occurred_at) AS first_seen_at,
             max(v.occurred_at) AS last_seen_at
        FROM visits v
        JOIN contacts ct ON ct.id = v.contact_id AND ct.workspace_id = ${ctx.workspaceId}
       GROUP BY v.contact_id, ct.email, ct.first_name, ct.last_name
       ORDER BY max(v.occurred_at) DESC
       LIMIT ${VISITOR_SAMPLE_LIMIT}
    )
    SELECT (SELECT count(*)::int FROM clicks)                          AS clicked_contacts,
           (SELECT count(DISTINCT contact_id)::int FROM visits)        AS visitor_contacts,
           (SELECT count(*)::int FROM visits WHERE name = 'page_view') AS page_views,
           (SELECT count(*)::int FROM visits WHERE name <> 'page_view') AS other_events,
           (SELECT count(DISTINCT session_id)::int FROM visits)        AS sessions,
           (SELECT max(occurred_at) FROM visits)                       AS last_visit_at,
           (SELECT coalesce(json_agg(pages), '[]'::json) FROM pages)   AS pages,
           (SELECT coalesce(json_agg(events), '[]'::json) FROM events) AS events,
           (SELECT coalesce(json_agg(visitors), '[]'::json) FROM visitors) AS visitors
  `);

  const row = rows[0];
  if (!row) return empty;

  return {
    ...empty,
    clickedContacts: Number(row['clicked_contacts'] ?? 0),
    visitorContacts: Number(row['visitor_contacts'] ?? 0),
    pageViews: Number(row['page_views'] ?? 0),
    otherEvents: Number(row['other_events'] ?? 0),
    sessions: Number(row['sessions'] ?? 0),
    lastVisitAt: asDate(row['last_visit_at'])?.toISOString() ?? null,
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
    visitors: asArray(row['visitors']).map((item) => ({
      contactId: String(item['contact_id']),
      email: String(item['email'] ?? ''),
      name: String(item['name'] ?? '').trim(),
      pageViews: Number(item['page_views'] ?? 0),
      events: Number(item['events'] ?? 0),
      firstSeenAt: new Date(item['first_seen_at'] as string).toISOString(),
      lastSeenAt: new Date(item['last_seen_at'] as string).toISOString(),
    })),
  };
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** `json_agg` vrací pole objektů, ale ovladač ho typuje jako `unknown`. */
function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}
