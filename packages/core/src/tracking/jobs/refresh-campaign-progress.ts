import { sql } from 'drizzle-orm';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { trackingLogger } from '../logging';
import { withTrackingTx, type Tx } from '../repo/tx';
import { SYSTEM_CLICK_SUBTYPE } from '../types';

export const REFRESH_CAMPAIGN_PROGRESS_QUEUE = 'tracking.refresh_campaign_progress';

/**
 * Průběh odesílání a doručenost kampaně.
 *
 * Dvě věci, které do teď NIKDO nezapisoval, takže `campaign_stats` u skutečně
 * odeslané kampaně vůbec neexistovala a report ukazoval nuly ve všech dlaždicích
 * včetně „doručeno":
 *
 *  1. PRŮBĚH (`materialized`, `sent`, `failed`, `skipped`,
 *     `progress_watermark_at`, `campaign_stats_buckets.sent`). Zdrojem je
 *     outbox, tedy tabulka `messages`, ne události. Sender by jinak musel na
 *     každou zprávu zapsat řádek `sent` do `message_events`, což je u milionové
 *     kampaně milion zápisů za údaj, který na řádku zprávy už je (3.9.5).
 *  2. DORUČENOST (`delivered`, `bounced_hard`, `bounced_soft`, `complained`,
 *     `unsubscribed`, `clicks_scanner`). Zdrojem jsou `message_events`,
 *     protože doručení se dozvíme jedině od poskytovatele.
 *
 * **Přepisuje se celou hodnotou, nepřičítá se.** Proto je opakované spuštění bez
 * následku a proto se čísla nemůžou rozejít, ani když job mezi dvěma běhy spadne.
 * Přírůstkový zapisovatel `process-engagement.ts` sahá na JINÉ sloupce
 * (otevření a prokliky), takže si ti dva nevadí.
 */

/** Šířka bloku v grafu průběhu. */
const BUCKET_SECONDS = 300;

/**
 * O kolik se sahá zpět za vodoznak. Sender běží ve víc instancích a `sent_at`
 * mezi nimi není striktně monotónní, takže zpráva může dorazit do bloku, který
 * se už jednou zapsal.
 */
const WATERMARK_LOOKBACK_MINUTES = 10;

export type CampaignProgressTarget = {
  campaignId: string;
  audienceBuiltAt: Date;
};

/**
 * Kampaň a její projekt jako JEDNA pojmenovaná hodnota.
 *
 * `identity/scope.test.ts` zakazuje exportované funkci mimo
 * `packages/core/src/tx` holý parametr `workspaceId: string`: takový řetězec
 * může přijít odkudkoliv a funkce se podle něj sama dotáže databáze.
 * Pojmenovaný typ nutí u každého volání napsat, co ta hodnota je.
 */
export type CampaignProgressScope = CampaignProgressTarget & { workspaceId: string };

/** Totéž bez publika: přepočet doručenosti oddíl zpráv nepotřebuje. */
export type CampaignDeliveryScope = { workspaceId: string; campaignId: string };

/**
 * Kampaně projektu, u kterých se má průběh přepočítat.
 *
 * Výběr je širší než „právě se odesílá" a je to podstatné: kampaň ve stavu
 * `sent` má hotová čísla, ale řádek souhrnu jí mohl vzniknout až po dokončení
 * (nebo nevzniknout vůbec, což byl přesně stav v produkci). Podmínka porovnává
 * souhrn s čítači kampaně, takže se dorovná jednou a pak se kampaň z výběru
 * sama vypadne. Dotaz sahá jen na `campaigns` a `campaign_stats`, tedy na dva
 * řádky, ne na outbox.
 */
export async function listCampaignsNeedingProgress(
  tx: Tx,
  workspaceId: string,
): Promise<CampaignProgressTarget[]> {
  const { rows } = await tx.execute<{ campaignId: string; audienceBuiltAt: Date }>(sql`
    SELECT c.id AS "campaignId", c.audience_built_at AS "audienceBuiltAt"
      FROM campaigns c
      LEFT JOIN campaign_stats s
             ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${workspaceId}::uuid
       AND c.deleted_at IS NULL
       AND c.audience_built_at IS NOT NULL
       AND (
             c.status IN ('queueing', 'sending', 'paused')
          OR s.campaign_id IS NULL
          OR s.sent         <> c.sent_count
          OR s.failed       <> c.failed_count
          OR s.skipped      <> c.skipped_count
          OR s.materialized <> c.total_count
       )
     ORDER BY c.id
  `);
  return rows.map((row) => ({
    campaignId: row.campaignId,
    audienceBuiltAt: new Date(row.audienceBuiltAt),
  }));
}

/** Přepočet průběhu i doručenosti jedné kampaně. Idempotentní. */
export async function refreshCampaignProgress(scope: CampaignProgressScope): Promise<void> {
  const { workspaceId } = scope;
  await withTrackingTx({ workspaceId, job: REFRESH_CAMPAIGN_PROGRESS_QUEUE }, async (tx) => {
    await refreshProgressIn(tx, workspaceId, scope);
    await refreshDeliveryCountersIn(tx, workspaceId, scope.campaignId);
  });
}

async function refreshProgressIn(
  tx: Tx,
  workspaceId: string,
  target: CampaignProgressTarget,
): Promise<void> {
  // Souhrn se počítá nad CELOU kampaní, ne přírůstkově. Je to jeden index scan
  // po `idx_messages__campaign_status` v jedné partition a proti přírůstku má
  // tu vlastnost, že se čísla nemůžou rozejít ani po výpadku.
  const { rows: totals } = await tx.execute<{
    materialized: string;
    sent: string;
    failed: string;
    skipped: string;
    watermark: Date | string | null;
  }>(sql`
    SELECT count(*)                                    AS materialized,
           count(*) FILTER (WHERE status = 'sent')     AS sent,
           count(*) FILTER (WHERE status = 'failed')   AS failed,
           count(*) FILTER (WHERE status = 'skipped')  AS skipped,
           max(sent_at)                                AS watermark
      FROM messages
     WHERE workspace_id = ${workspaceId}::uuid
       AND campaign_id  = ${target.campaignId}::uuid
       AND created_at   = ${target.audienceBuiltAt}
       AND kind = 'campaign'
  `);
  const total = totals[0];
  if (total === undefined) return;

  // `tx.execute` vrací syrový výsledek ovladače, takže timestamptz přijde
  // jednou jako `Date` a jindy jako řetězec. Bez převodu spadne aritmetika
  // s vodoznakem níž na `getTime is not a function`.
  const watermark =
    total.watermark === null
      ? null
      : total.watermark instanceof Date
        ? total.watermark
        : new Date(total.watermark);

  await tx.execute(sql`
    INSERT INTO campaign_stats (
      workspace_id, campaign_id, materialized, sent, failed, skipped,
      progress_watermark_at, updated_at, version)
    VALUES (
      ${workspaceId}::uuid, ${target.campaignId}::uuid, ${Number(total.materialized)},
      ${Number(total.sent)}, ${Number(total.failed)}, ${Number(total.skipped)},
      ${watermark}, now(), 1)
    ON CONFLICT (campaign_id) DO UPDATE SET
      materialized          = excluded.materialized,
      sent                  = excluded.sent,
      failed                = excluded.failed,
      skipped               = excluded.skipped,
      progress_watermark_at = excluded.progress_watermark_at,
      updated_at            = now(),
      version               = campaign_stats.version + 1
  `);

  // Bloky se přepisují CELOU hodnotou, ne přičtením, takže dvojí běh dá tentýž
  // graf. Sahá se jen za vodoznak minus dva bloky.
  const since =
    watermark === null
      ? target.audienceBuiltAt
      : new Date(watermark.getTime() - WATERMARK_LOOKBACK_MINUTES * 60_000);

  await tx.execute(sql`
    INSERT INTO campaign_stats_buckets (workspace_id, campaign_id, bucket_at, sent)
    SELECT ${workspaceId}::uuid, ${target.campaignId}::uuid,
           to_timestamp(floor(extract(epoch FROM sent_at) / ${BUCKET_SECONDS}) * ${BUCKET_SECONDS}),
           count(*) FILTER (WHERE status = 'sent')
      FROM messages
     WHERE workspace_id = ${workspaceId}::uuid
       AND campaign_id  = ${target.campaignId}::uuid
       AND created_at   = ${target.audienceBuiltAt}
       AND kind = 'campaign'
       AND sent_at IS NOT NULL
       AND sent_at >= ${since}
     GROUP BY 3
    ON CONFLICT (workspace_id, campaign_id, bucket_at) DO UPDATE SET
      sent = excluded.sent
  `);
}

/**
 * Doručenost a odhlášení z `message_events`.
 *
 * Počítá se `count(DISTINCT message_id)`, ne počet řádků: poskytovatel doručí
 * tutéž událost víckrát a odhlásit se z jedné zprávy jde taky opakovaně.
 * Tentýž vzorec má `reports/campaign-stats/recompute.ts`, takže kontrola driftu
 * porovnává dvě čísla spočtená stejně.
 */
async function refreshDeliveryCountersIn(
  tx: Tx,
  workspaceId: string,
  campaignId: string,
): Promise<void> {
  const { rows } = await tx.execute<{
    delivered: string;
    rejected: string;
    bouncedHard: string;
    bouncedSoft: string;
    complained: string;
    unsubscribed: string;
    clicksScanner: string;
  }>(sql`
    SELECT count(DISTINCT message_id) FILTER (WHERE type = 'delivered')    AS "delivered",
           -- Odmítnutí poskytovatelem. Počítá se stejně jako odrazy, tedy
           -- count(DISTINCT message_id), protože i odmítnutí umí přijít víckrát.
           count(DISTINCT message_id) FILTER (WHERE type = 'rejected')     AS "rejected",
           count(DISTINCT message_id) FILTER (WHERE type = 'bounced_hard') AS "bouncedHard",
           count(DISTINCT message_id) FILTER (WHERE type = 'bounced_soft') AS "bouncedSoft",
           count(DISTINCT message_id) FILTER (WHERE type = 'complained')   AS "complained",
           count(DISTINCT message_id) FILTER (WHERE type = 'unsubscribe')  AS "unsubscribed",
           -- Vše, co není human, tedy scanner, bot i prefetch. Výčet se
           -- schválně neopisuje: reports/event-types.ts má
           -- NON_HUMAN_CLICK_SUBTYPES jako seznam a druhá kopie by se s ním
           -- rozešla při první nové třídě. Negace je proti výčtu ClickClass
           -- ekvivalentní a nová třída se do ní započítá sama.
           --
           -- Systémový proklik je z negace VYJMUTÝ jmenovitě. Jeho podtyp
           -- neodpovídá na otázku „člověk, nebo stroj", ale „na co se kliklo",
           -- takže do výčtu ClickClass nepatří a mezi skenery ho poslat nesmíme:
           -- report by tvrdil, že za odesílatelem chodí robot, pokaždé když si
           -- příjemce otevře centrum předvoleb. Protějšek v
           -- reports/campaign-stats/recompute.ts filtruje výčtem
           -- NON_HUMAN_CLICK_SUBTYPES, ve kterém systémový podtyp taky není,
           -- takže obě čísla zůstávají spočtená stejně a kontrola driftu mlčí.
           count(*) FILTER (WHERE type = 'click'
                              AND subtype <> 'human'
                              AND subtype <> ${SYSTEM_CLICK_SUBTYPE})       AS "clicksScanner"
      FROM message_events
     WHERE workspace_id = ${workspaceId}::uuid
       AND campaign_id  = ${campaignId}::uuid
  `);
  const row = rows[0];
  if (row === undefined) return;

  await tx.execute(sql`
    INSERT INTO campaign_stats (
      workspace_id, campaign_id, delivered, rejected, bounced_hard, bounced_soft,
      complained, unsubscribed, clicks_scanner, updated_at, version)
    VALUES (
      ${workspaceId}::uuid, ${campaignId}::uuid, ${Number(row.delivered)},
      ${Number(row.rejected)},
      ${Number(row.bouncedHard)}, ${Number(row.bouncedSoft)}, ${Number(row.complained)},
      ${Number(row.unsubscribed)}, ${Number(row.clicksScanner)}, now(), 1)
    ON CONFLICT (campaign_id) DO UPDATE SET
      delivered      = excluded.delivered,
      rejected       = excluded.rejected,
      bounced_hard   = excluded.bounced_hard,
      bounced_soft   = excluded.bounced_soft,
      complained     = excluded.complained,
      unsubscribed   = excluded.unsubscribed,
      clicks_scanner = excluded.clicks_scanner,
      updated_at     = now(),
      version        = campaign_stats.version + 1
  `);
}

/** Přepočet jen doručenosti. Volá se hned po odhlášení a po událostech od providera. */
export async function refreshDeliveryCounters(scope: CampaignDeliveryScope): Promise<void> {
  await withTrackingTx(
    { workspaceId: scope.workspaceId, job: REFRESH_CAMPAIGN_PROGRESS_QUEUE },
    (tx) => refreshDeliveryCountersIn(tx, scope.workspaceId, scope.campaignId),
  );
}

/**
 * Obsluha cronové fronty `tracking.refresh_campaign_progress`.
 *
 * Dvoutaktní postup, který v tomhle repozitáři platí pro každou systémovou
 * úlohu: sken pod rolí `mlain_maintenance` vrátí POUZE identifikátory projektů,
 * všechna další práce běží pod `mlain_app` v kontextu jednoho projektu, takže
 * na ni dopadá RLS stejně jako na požadavek z API.
 *
 * Bez `DATABASE_URL_MAINTENANCE` vrátí sken chybu a úloha skončí v chybě.
 * Je to lepší než prázdný seznam: prázdný seznam by vypadal jako úspěšný běh
 * bez práce a průběh kampaně by zamrzl na nule navždy.
 */
export async function handleRefreshCampaignProgress(): Promise<void> {
  const workspaceIds = await listWorkspaceIds();
  let refreshed = 0;

  for (const workspaceId of workspaceIds) {
    const targets = await withTrackingTx(
      { workspaceId, job: REFRESH_CAMPAIGN_PROGRESS_QUEUE },
      (tx) => listCampaignsNeedingProgress(tx, workspaceId),
    );
    for (const target of targets) {
      await refreshCampaignProgress({ workspaceId, ...target });
      refreshed += 1;
    }
  }

  if (refreshed > 0) {
    trackingLogger().debug(
      { job: REFRESH_CAMPAIGN_PROGRESS_QUEUE, campaigns: refreshed },
      'průběh kampaní přepočten',
    );
  }
}
