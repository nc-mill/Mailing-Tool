import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';
import type { Tile, TileCache } from './cache';

export const DASHBOARD_PERIODS = [7, 30, 90] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** Prahy z 8.11.1 části 6, hodnoty vlastní část 4a (3.15.2). */
export const BOUNCE_WARN = 0.04;
export const COMPLAINT_WARN = 0.001;

const STATS_TTL_MS = 60_000;
const WEB_TTL_MS = 300_000;

export type DashboardResponse = {
  periodDays: DashboardPeriod;
  computedAt: string;
  tiles: {
    sent: Tile<{ value: number }>;
    click_rate: Tile<{ rate: number | null; delta: number | null }>;
    open_rate: Tile<{ rate: number | null; machineShare: number | null }>;
    problems: Tile<{
      bounceRate: number | null;
      complaintRate: number | null;
      level: 'ok' | 'warn' | 'bad';
    }>;
    web_active: Tile<{ contacts: number }>;
    recent_campaigns: Tile<{ items: RecentCampaign[] }>;
    running: Tile<{ campaign: RunningCampaign | null }>;
  };
};

/**
 * Jedna kampaň v dlaždici „poslední kampaně".
 *
 * Nese i syrové počty, ne jen `clickRate`. Obrazovka Statistiky (úkol 35)
 * z téhle dlaždice kreslí vývoj měr v čase a potřebuje k tomu jmenovatele.
 * Kdyby tu byla jen hotová míra, spočítala by si graf podíly z `undefined`
 * a vykreslil samé nuly, aniž by cokoliv spadlo.
 */
export type RecentCampaign = {
  campaignId: string;
  name: string;
  status: string;
  startedAt: string | null;
  clickRate: number | null;
  sent: number;
  delivered: number;
  deliveredEffective: number;
  opens: number;
  opensApple: number;
  clicks: number;
  unsubscribed: number;
};

export type RunningCampaign = {
  campaignId: string;
  name: string;
  sent: number;
  total: number;
};

type Totals = {
  sent: number;
  deliveredEffective: number;
  bounced: number;
  complained: number;
  opensUnique: number;
  opensApple: number;
  clicksHuman: number;
};

export async function readDashboard(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { periodDays: DashboardPeriod; timezone: string; cache: TileCache },
): Promise<DashboardResponse> {
  const key = (name: string) => `${ctx.workspaceId}:${input.periodDays}:${name}`;
  const now = new Date();
  const from = daysAgo(now, input.periodDays);
  const previousFrom = daysAgo(now, input.periodDays * 2);

  const [current, previous] = await Promise.all([
    input.cache.resolve(key('totals'), STATS_TTL_MS, () => readTotals(tx, ctx, from, now)),
    input.cache.resolve(key('totals_previous'), STATS_TTL_MS, () =>
      readTotals(tx, ctx, previousFrom, from),
    ),
  ]);

  const [webActive, recent, running] = await Promise.all([
    input.cache.resolve(key('web_active'), WEB_TTL_MS, async () => ({
      contacts: await readWebActive(tx, ctx),
    })),
    input.cache.resolve(key('recent'), STATS_TTL_MS, async () => ({
      items: await readRecentCampaigns(tx, ctx, from, now),
    })),
    input.cache.resolve(key('running'), STATS_TTL_MS, async () => ({
      campaign: await readRunningCampaign(tx, ctx),
    })),
  ]);

  return {
    periodDays: input.periodDays,
    computedAt: now.toISOString(),
    tiles: {
      sent: mapTile(current, (t) => ({ value: t.sent })),
      click_rate: mapTile(current, (t) => ({
        rate: ratio(t.clicksHuman, t.deliveredEffective),
        delta: deltaOf(current, previous),
      })),
      open_rate: mapTile(current, (t) => ({
        rate: ratio(t.opensUnique, t.deliveredEffective),
        machineShare: ratio(t.opensApple, t.opensUnique),
      })),
      problems: mapTile(current, (t) => {
        const bounceRate = ratio(t.bounced, t.sent);
        const complaintRate = ratio(t.complained, t.deliveredEffective);
        return { bounceRate, complaintRate, level: severity(bounceRate, complaintRate) };
      }),
      web_active: webActive,
      recent_campaigns: recent,
      running,
    },
  };
}

/**
 * Vážený průměr přes kampaně se počítá jako podíl součtů, ne jako průměr podílů.
 * Průměr podílů by dal kampani na deset lidí stejnou váhu jako kampani na deset tisíc.
 *
 * Míra prokliku bere ověřené prokliky (clicks_unique_human), stejně jako report.
 * Definice metrik vlastní část 5 (3.11.3), 8.11.1 části 6 na ni odkazuje.
 *
 * Řídicí tabulka je `campaigns`, ne `campaign_stats`, a spojení je LEFT JOIN.
 * Řádek agregace zakládá až první běh jobu z P10, takže ho čerstvě odeslaná
 * kampaň ještě nemá. S `FROM campaign_stats` by z přehledu vypadla úplně,
 * a je to právě ta kampaň, kvůli které se uživatel na přehled dívá. Nespadlo
 * by nic, jen by chyběla. Každý čítač proto prochází `coalesce(..., 0)`
 * dvakrát: jednou proti chybějícímu řádku, podruhé proti prázdné množině.
 */
async function readTotals(tx: Tx, ctx: WorkspaceContext, from: Date, to: Date): Promise<Totals> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT coalesce(sum(coalesce(s.sent, 0)), 0)   AS sent,
           coalesce(sum(
             CASE WHEN p.type = 'smtp' OR coalesce(s.delivered, 0) = 0
                  THEN greatest(coalesce(s.sent, 0) - coalesce(s.bounced_hard, 0)
                                - coalesce(s.bounced_soft, 0) - coalesce(s.failed, 0), 0)
                  ELSE s.delivered END
           ), 0)                                   AS delivered_effective,
           coalesce(sum(coalesce(s.bounced_hard, 0) + coalesce(s.bounced_soft, 0)), 0) AS bounced,
           coalesce(sum(coalesce(s.complained, 0)), 0)          AS complained,
           coalesce(sum(coalesce(s.opens_unique, 0)), 0)        AS opens_unique,
           coalesce(sum(coalesce(s.opens_unique_apple, 0)), 0)  AS opens_apple,
           coalesce(sum(coalesce(s.clicks_unique_human, 0)), 0) AS clicks_human
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
      LEFT JOIN sending_providers p ON p.id = c.provider_id AND p.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.deleted_at IS NULL
       AND c.started_at >= ${from}
       AND c.started_at <  ${to}
  `);
  const row = rows[0] ?? {};
  return {
    sent: Number(row['sent'] ?? 0),
    deliveredEffective: Number(row['delivered_effective'] ?? 0),
    bounced: Number(row['bounced'] ?? 0),
    complained: Number(row['complained'] ?? 0),
    opensUnique: Number(row['opens_unique'] ?? 0),
    opensApple: Number(row['opens_apple'] ?? 0),
    clicksHuman: Number(row['clicks_human'] ?? 0),
  };
}

/**
 * Jediný dotaz přehledu, který sahá do web_events.
 *
 * Dvě podmínky, obě povinné a každá z jiného důvodu:
 *   - `received_at` je partiční klíč a prořezává na jednu, nejvýš dvě partition,
 *   - `occurred_at` je ve sloupcích indexu `idx_web_events__contact_occurred
 *     (workspace_id, contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL`,
 *     takže se dotaz přečte z indexu.
 *
 * Se samotným `received_at` by uvnitř oddílu nezbylo nic než sekvenční průchod:
 * index nad dvojicí `(workspace_id, received_at)` v P03 NENÍ. Oddíl je přitom
 * měsíc událostí **celé instalace**, ne jednoho projektu.
 *
 * Dolní mez `received_at` má minutovou rezervu, protože `ck_web_events__lag`
 * povoluje `received_at` až o minutu před `occurred_at`.
 */
async function readWebActive(tx: Tx, ctx: WorkspaceContext): Promise<number> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT count(DISTINCT contact_id) AS contacts
      FROM web_events
     WHERE workspace_id = ${ctx.workspaceId}
       AND contact_id IS NOT NULL
       AND occurred_at >= now() - interval '24 hours'
       AND received_at >= now() - interval '24 hours' - interval '60 seconds'
       AND received_at <  now() + interval '7 days'
  `);
  return Number(rows[0]?.['contacts'] ?? 0);
}

/** Kolik kampaní se vejde do dlaždice a zároveň stačí grafu vývoje (úkol 35). */
const RECENT_CAMPAIGNS_LIMIT = 24;

/**
 * Poslední kampaně **zvoleného období**, ne posledních pět bez ohledu na filtr.
 * Perioda se respektuje ze stejného důvodu jako u dlaždic: kdyby ji dlaždice
 * ignorovala, ukazovala by přehled za sedm dní kampaně staré půl roku.
 */
async function readRecentCampaigns(
  tx: Tx,
  ctx: WorkspaceContext,
  from: Date,
  to: Date,
): Promise<RecentCampaign[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.id, c.name, c.status, c.started_at, p.type AS provider_type,
           s.clicks_unique_human, s.delivered, s.sent, s.bounced_hard, s.bounced_soft,
           s.failed, s.opens_unique, s.opens_unique_apple, s.unsubscribed
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
      LEFT JOIN sending_providers p ON p.id = c.provider_id AND p.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.deleted_at IS NULL
       AND c.started_at IS NOT NULL
       AND c.started_at >= ${from}
       AND c.started_at <  ${to}
     ORDER BY c.started_at DESC
     LIMIT ${RECENT_CAMPAIGNS_LIMIT}
  `);
  return rows.map((row) => {
    const delivered = Number(row['delivered'] ?? 0);
    const derived = Math.max(
      Number(row['sent'] ?? 0) -
        Number(row['bounced_hard'] ?? 0) -
        Number(row['bounced_soft'] ?? 0) -
        Number(row['failed'] ?? 0),
      0,
    );
    // Stejné pravidlo jako v readTotals: SMTP provider události doručení neposílá.
    const base = row['provider_type'] === 'smtp' || delivered === 0 ? derived : delivered;
    return {
      campaignId: String(row['id']),
      name: String(row['name']),
      status: String(row['status']),
      startedAt: row['started_at']
        ? new Date(row['started_at'] as string | Date).toISOString()
        : null,
      clickRate: ratio(Number(row['clicks_unique_human'] ?? 0), base),
      sent: Number(row['sent'] ?? 0),
      delivered,
      deliveredEffective: base,
      opens: Number(row['opens_unique'] ?? 0),
      opensApple: Number(row['opens_unique_apple'] ?? 0),
      clicks: Number(row['clicks_unique_human'] ?? 0),
      unsubscribed: Number(row['unsubscribed'] ?? 0),
    };
  });
}

async function readRunningCampaign(tx: Tx, ctx: WorkspaceContext): Promise<RunningCampaign | null> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.id, c.name, coalesce(s.sent, 0) AS sent, coalesce(s.materialized, 0) AS total
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.deleted_at IS NULL
       AND c.status IN ('sending', 'queueing')
     ORDER BY c.started_at DESC NULLS LAST
     LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    campaignId: String(row['id']),
    name: String(row['name']),
    sent: Number(row['sent'] ?? 0),
    total: Number(row['total'] ?? 0),
  };
}

function mapTile<T, U>(tile: Tile<T>, project: (value: T) => U): Tile<U> {
  if (tile.status === 'error') return tile;
  return { status: 'ok', data: project(tile.data), computedAt: tile.computedAt, stale: tile.stale };
}

function deltaOf(current: Tile<Totals>, previous: Tile<Totals>): number | null {
  if (current.status !== 'ok' || previous.status !== 'ok') return null;
  const now = ratio(current.data.clicksHuman, current.data.deliveredEffective);
  const before = ratio(previous.data.clicksHuman, previous.data.deliveredEffective);
  if (now === null || before === null) return null;
  return now - before;
}

function severity(bounceRate: number | null, complaintRate: number | null): 'ok' | 'warn' | 'bad' {
  if ((bounceRate ?? 0) > BOUNCE_WARN || (complaintRate ?? 0) > COMPLAINT_WARN) return 'bad';
  if ((bounceRate ?? 0) > BOUNCE_WARN / 2 || (complaintRate ?? 0) > COMPLAINT_WARN / 2)
    return 'warn';
  return 'ok';
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}
