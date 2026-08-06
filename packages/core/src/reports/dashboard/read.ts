import { sql } from 'drizzle-orm';
import { contactExistsForJoinSql } from '../../contacts/existence';
import type { Tx, WorkspaceContext } from '../../tx';
import { isDeliveredKnown, resolveDeliveredSource } from '../campaign-stats/read';
import { countsFromRow } from '../metrics/counts';
import { deliveredEffective } from '../metrics/rates';
import type { Tile, TileCache } from './cache';

export const DASHBOARD_PERIODS = [7, 30, 90] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** Prahy z 8.11.1 části 6, hodnoty vlastní část 4a (3.15.2). */
export const BOUNCE_WARN = 0.04;
export const COMPLAINT_WARN = 0.001;

const STATS_TTL_MS = 60_000;
const WEB_TTL_MS = 300_000;

/**
 * Kolik kampaní období stojí mimo míry, protože u nich neznáme doručenost.
 *
 * Nese to KAŽDÁ dlaždice s mírou, ne jedna společná poznámka pod obrazovkou.
 * Uživatel se dívá na jedno číslo a musí u něj vidět, z čeho vzniklo; poznámka
 * o kus dál se přečte jako komentář k něčemu jinému.
 */
export type UnknownDelivery = { campaigns: number; sent: number };

export type DashboardResponse = {
  periodDays: DashboardPeriod;
  computedAt: string;
  tiles: {
    /**
     * `delta` je RELATIVNÍ změna počtu odeslaných zpráv proti minulému období
     * (0.1 znamená o desetinu víc), kdežto u měr je to rozdíl dvou podílů.
     * Jsou to dvě různé veličiny se stejným názvem schválně: dlaždice o nich
     * mluví stejnou větou („od minulého období") a obě se ukazují v procentech.
     */
    sent: Tile<{ value: number; delta: number | null }>;
    click_rate: Tile<{
      rate: number | null;
      delta: number | null;
      clicks: number;
      unknown: UnknownDelivery;
    }>;
    open_rate: Tile<{
      rate: number | null;
      delta: number | null;
      machineShare: number | null;
      opens: number;
      unknown: UnknownDelivery;
    }>;
    problems: Tile<{
      bounceRate: number | null;
      complaintRate: number | null;
      level: 'ok' | 'warn' | 'bad' | 'unknown';
      unknown: UnknownDelivery;
    }>;
    web_active: Tile<{ contacts: number; people: WebActivePerson[] }>;
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
  /**
   * Víme u téhle kampaně, kolik zpráv dorazilo?
   *
   * Bez toho příznaku počítá každý konzument dlaždice míry z `deliveredEffective`,
   * aniž by tušil, že je to u tiché odesílací služby dopočtená hodnota, ne
   * měření. Obrazovka Statistiky z toho kreslila „Doručeno 100 %" u kampaně,
   * o jejíž doručenosti nevíme vůbec nic. Stejný příznak nese
   * `/campaigns/{id}/stats` jako `delivered_known`.
   */
  deliveredKnown: boolean;
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

/**
 * Součty období rozdělené podle toho, jestli u kampaně VÍME, kolik zpráv došlo.
 *
 * Rozdělení je jádro téhle opravy. Přehled dřív sčítal všechno dohromady
 * a kampani bez jediné události od odesílací služby dopočítal doručenost jako
 * „odesláno minus odrazy". U poskytovatele, od kterého žádné události nechodí
 * (na vývojové instalaci Amazon SNS, protože odběr na `localhost` se nepotvrdí),
 * je to ale ODHAD, ne měření: odrazy taky neznáme, takže se od odeslaných nic
 * neodečte a jmenovatel vyjde jako počet odeslaných. Otevření se přitom měří
 * pixelem, tedy nezávisle na poskytovateli, a klidně jich je víc než odeslaných
 * zpráv. Přehled pak ukázal „Otevřelo 185,7 %".
 *
 * Pravidlo je JEDNO pro celý produkt a bydlí v `campaign-stats/read.ts`:
 * `resolveDeliveredSource` + `isDeliveredKnown`. Report kampaně podle něj píše
 * „Zatím nevíme", přehled podle něj teď míru vůbec nespočítá.
 *
 * Absolutní počty (odesláno, otevření, prokliky) se sčítají přes VŠECHNY
 * kampaně, protože ty naměřené jsou. Vypadnou jen MÍRY, u kterých chybí
 * jmenovatel. Uživatel tak nepřijde o čísla, jen se z nich přestane počítat
 * podíl, který by nic neznamenal.
 */
type Totals = {
  sent: number;
  opensUnique: number;
  opensApple: number;
  clicksHuman: number;
  /** Podmnožina kampaní se známou doručeností. Jediný podklad pro míry. */
  known: {
    campaigns: number;
    sent: number;
    deliveredEffective: number;
    bounced: number;
    complained: number;
    opensUnique: number;
    clicksHuman: number;
  };
  unknown: UnknownDelivery;
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
    input.cache.resolve(key('web_active'), WEB_TTL_MS, () => readWebActive(tx, ctx)),
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
      sent: mapTile(current, (t) => ({ value: t.sent, delta: countDelta(current, previous) })),
      click_rate: mapTile(current, (t) => ({
        rate: ratio(t.known.clicksHuman, t.known.deliveredEffective),
        delta: rateDelta(current, previous, (totals) => [
          totals.known.clicksHuman,
          totals.known.deliveredEffective,
        ]),
        clicks: t.clicksHuman,
        unknown: t.unknown,
      })),
      open_rate: mapTile(current, (t) => ({
        rate: ratio(t.known.opensUnique, t.known.deliveredEffective),
        delta: rateDelta(current, previous, (totals) => [
          totals.known.opensUnique,
          totals.known.deliveredEffective,
        ]),
        // Podíl automatických otevření má jmenovatel z TÉHOŽ měření jako
        // čitatel, takže na doručenosti nestojí a počítá se přes vše.
        machineShare: ratio(t.opensApple, t.opensUnique),
        opens: t.opensUnique,
        unknown: t.unknown,
      })),
      problems: mapTile(current, (t) => {
        // Odrazy se dělí ODESLANÝMI, ne doručenými: odražená zpráva z definice
        // doručená není. Stejný jmenovatel má `computeRates` v reportu.
        const bounceRate = ratio(t.known.bounced, t.known.sent);
        const complaintRate = ratio(t.known.complained, t.known.deliveredEffective);
        return {
          bounceRate,
          complaintRate,
          level: severity(bounceRate, complaintRate, t),
          unknown: t.unknown,
        };
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
  /*
   * Řádek na kampaň, součet až v TypeScriptu.
   *
   * Sečíst to rovnou v SQL by znamenalo napsat `CASE WHEN p.type = 'smtp' OR …`
   * podruhé, tentokrát v jazyce, ve kterém se to nedá otestovat vedle původního
   * pravidla. Přesně tak vznikla vada, kterou tahle změna opravuje: přehled měl
   * vlastní `CASE` a report vlastní funkci, obojí o téže věci, a jen jedno z toho
   * se opravilo. Klasifikace proto zůstává na jednom místě
   * (`resolveDeliveredSource`, `isDeliveredKnown`, `deliveredEffective`)
   * a dotaz vrací jen syrové čítače.
   *
   * Cena je jeden řádek na kampaň období místo jednoho řádku celkem. Kampaní je
   * i za devadesát dní řádově desítky, řádek je pár čísel a dlaždice má cache
   * na minutu; sousední dotaz `readRecentCampaigns` čte z téže tabulky totéž.
   */
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT p.type AS provider_type,
           s.sent, s.delivered, s.failed, s.bounced_hard, s.bounced_soft, s.complained,
           s.opens_unique, s.opens_unique_apple, s.clicks_unique_human
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
      LEFT JOIN sending_providers p ON p.id = c.provider_id AND p.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.deleted_at IS NULL
       AND c.kind = 'campaign'
       AND c.started_at >= ${from}
       AND c.started_at <  ${to}
  `);

  const totals: Totals = {
    sent: 0,
    opensUnique: 0,
    opensApple: 0,
    clicksHuman: 0,
    known: {
      campaigns: 0,
      sent: 0,
      deliveredEffective: 0,
      bounced: 0,
      complained: 0,
      opensUnique: 0,
      clicksHuman: 0,
    },
    unknown: { campaigns: 0, sent: 0 },
  };

  for (const row of rows) {
    const counts = countsFromRow(row);
    totals.sent += counts.sent;
    totals.opensUnique += counts.opensUnique;
    totals.opensApple += counts.opensUniqueApple;
    totals.clicksHuman += counts.clicksUniqueHuman;

    const source = resolveDeliveredSource(
      typeof row['provider_type'] === 'string' ? row['provider_type'] : null,
      counts,
    );
    if (!isDeliveredKnown(counts, source)) {
      totals.unknown.campaigns += 1;
      totals.unknown.sent += counts.sent;
      continue;
    }
    totals.known.campaigns += 1;
    totals.known.sent += counts.sent;
    totals.known.deliveredEffective += deliveredEffective(counts, source);
    totals.known.bounced += counts.bouncedHard + counts.bouncedSoft;
    totals.known.complained += counts.complained;
    totals.known.opensUnique += counts.opensUnique;
    totals.known.clicksHuman += counts.clicksUniqueHuman;
  }

  return totals;
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
 *
 * Dlaždice počítá LIDI, ne události, takže se ptá i na to, jestli ten člověk
 * v projektu ještě je. Události smazaného kontaktu v `web_events` zůstávají a bez
 * téhle podmínky by přehled hlásil aktivní návštěvníky, které uživatel den předtím
 * smazal. Podmínka je až za `contact_id IS NOT NULL`, aby se z indexu
 * `idx_web_events__contact_occurred` četlo dál a existence se ověřovala jen
 * u nalezených id.
 *
 * VEDLE POČTU VRACÍ I PÁR JMEN. Samotné číslo „6 kontaktů za 24 h" neodpovídá
 * na otázku, kterou si u té dlaždice člověk klade, totiž kdo to byl. Jména se
 * berou ze stejného průchodu událostmi (`GROUP BY contact_id` nad týmž indexem),
 * ne druhým dotazem: podmínky jsou doslova tytéž, takže se počet a seznam
 * nemůžou rozejít.
 */
const WEB_ACTIVE_PEOPLE_LIMIT = 5;

/** Kontakt, který byl za posledních 24 hodin na webu. */
export type WebActivePerson = {
  contactId: string;
  /** Celé jméno, pokud ho kontakt má. Jinak `null` a rozhodne e-mail. */
  name: string | null;
  email: string;
  lastSeenAt: string;
};

async function readWebActive(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<{ contacts: number; people: WebActivePerson[] }> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    WITH seen AS (
      SELECT we.contact_id, max(we.occurred_at) AS last_seen
        FROM web_events we
       WHERE we.workspace_id = ${ctx.workspaceId}
         AND we.contact_id IS NOT NULL
         AND we.occurred_at >= now() - interval '24 hours'
         AND we.received_at >= now() - interval '24 hours' - interval '60 seconds'
         AND we.received_at <  now() + interval '7 days'
         AND ${sql.raw(contactExistsForJoinSql('we'))}
       GROUP BY we.contact_id
    ),
    people AS (
      SELECT s.contact_id,
             nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '') AS name,
             c.email::text AS email,
             s.last_seen
        FROM seen s
        JOIN contacts c ON c.id = s.contact_id AND c.workspace_id = ${ctx.workspaceId}
       ORDER BY s.last_seen DESC
       LIMIT ${WEB_ACTIVE_PEOPLE_LIMIT}
    )
    SELECT (SELECT count(*)::int FROM seen) AS contacts,
           (SELECT coalesce(json_agg(people), '[]'::json) FROM people) AS people
  `);
  const row = rows[0] ?? {};
  const people = Array.isArray(row['people']) ? (row['people'] as Record<string, unknown>[]) : [];
  return {
    contacts: Number(row['contacts'] ?? 0),
    people: people.map((item) => ({
      contactId: String(item['contact_id']),
      name: item['name'] === null || item['name'] === undefined ? null : String(item['name']),
      email: String(item['email'] ?? ''),
      lastSeenAt: new Date(item['last_seen'] as string).toISOString(),
    })),
  };
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
           -- complained tu není zbytečně: rozhoduje o tom, jestli o osudu
           -- zpráv vůbec něco víme (isDeliveredKnown). Kampaň, ze které
           -- přišly jen stížnosti, doručenost měřenou má.
           s.complained, s.failed, s.opens_unique, s.opens_unique_apple, s.unsubscribed
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
      LEFT JOIN sending_providers p ON p.id = c.provider_id AND p.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.deleted_at IS NULL
       AND c.kind = 'campaign'
       AND c.started_at IS NOT NULL
       AND c.started_at >= ${from}
       AND c.started_at <  ${to}
     ORDER BY c.started_at DESC
     LIMIT ${RECENT_CAMPAIGNS_LIMIT}
  `);
  return rows.map((row) => {
    // Tatáž klasifikace jako v readTotals a v reportu kampaně. Dřív tu stálo
    // vlastní `provider_type === 'smtp' || delivered === 0 ? derived : delivered`,
    // což je jiné pravidlo pro totéž a právě z něj vznikalo „Doručeno 100 %"
    // u kampaně, o jejíž doručenosti nevíme nic.
    const counts = countsFromRow(row);
    const source = resolveDeliveredSource(
      typeof row['provider_type'] === 'string' ? row['provider_type'] : null,
      counts,
    );
    const known = isDeliveredKnown(counts, source);
    const base = deliveredEffective(counts, source);
    return {
      campaignId: String(row['id']),
      name: String(row['name']),
      status: String(row['status']),
      startedAt: row['started_at']
        ? new Date(row['started_at'] as string | Date).toISOString()
        : null,
      clickRate: known ? ratio(counts.clicksUniqueHuman, base) : null,
      deliveredKnown: known,
      sent: counts.sent,
      delivered: counts.delivered,
      deliveredEffective: base,
      opens: counts.opensUnique,
      opensApple: counts.opensUniqueApple,
      clicks: counts.clicksUniqueHuman,
      unsubscribed: counts.unsubscribed,
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
       AND c.kind = 'campaign'
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

/**
 * Rozdíl dvou měr: kolik procentních bodů přibylo od minulého období.
 *
 * `null` znamená „nemáme s čím porovnat", ne nulu. Když v jednom z období není
 * jediná kampaň se známou doručeností, jmenovatel neexistuje a dlaždice o změně
 * mlčí. Nula by tvrdila, že se nic nezměnilo, což je jiné sdělení.
 */
function rateDelta(
  current: Tile<Totals>,
  previous: Tile<Totals>,
  pick: (totals: Totals) => [number, number],
): number | null {
  if (current.status !== 'ok' || previous.status !== 'ok') return null;
  const now = ratio(...pick(current.data));
  const before = ratio(...pick(previous.data));
  if (now === null || before === null) return null;
  return now - before;
}

/**
 * Relativní změna počtu: o kolik se odeslané zprávy liší od minulého období.
 *
 * Míry se odečítají, počty se dělí. „O 3 zprávy víc" nic neříká, dokud není
 * vidět z kolika; „o polovinu víc" ano. Prázdné minulé období vrací `null`,
 * protože dělit nulou nejde a růst z nuly není procento.
 */
function countDelta(current: Tile<Totals>, previous: Tile<Totals>): number | null {
  if (current.status !== 'ok' || previous.status !== 'ok') return null;
  const before = previous.data.sent;
  if (before <= 0) return null;
  return (current.data.sent - before) / before;
}

/**
 * „Nevíme" je vlastní stupeň, ne „v pořádku".
 *
 * Odrazy a stížnosti se dozvíme JEN od odesílací služby. Když od ní nedorazila
 * ani jedna událost, jsou obě čísla nula, jenže ta nula neříká „nic se
 * nestalo", nýbrž „nic jsme se nedozvěděli". Zelené „v pořádku" nad takovou
 * nulou je tvrzení, které produkt nemá čím podložit.
 *
 * Prázdný projekt zůstává v pořádku: kde se nic neodeslalo, není co hlídat.
 */
function severity(
  bounceRate: number | null,
  complaintRate: number | null,
  totals: Totals,
): 'ok' | 'warn' | 'bad' | 'unknown' {
  if (totals.known.sent === 0 && totals.unknown.sent > 0) return 'unknown';
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
