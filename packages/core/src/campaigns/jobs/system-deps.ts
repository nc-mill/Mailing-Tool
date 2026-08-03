import { loadConfig } from '../../config/index';
import { createSystemContext } from '../../identity/context';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import {
  listPausedOnQuota,
  listRunningCampaigns,
  listWorkspaceIds,
} from '../../platform/maintenance-scan';
import { getProviderById } from '../../providers/repo/provider';
import { quotaRemaining } from '../../providers/ses/account';
import { writeAuditLog } from '../../audit/write';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { CampaignAuditActions } from '../audit';
import { enqueueCampaignJob } from '../api/service';
import { resumeCampaign } from '../control/resume';
import { claimDueCampaignRows, markScheduleMissedIds, transitionStatus } from '../repo/campaign';
import {
  isOutboxDrained,
  reconcileDeliveryCounters,
  reconcileHandoverCounters,
} from '../repo/counters';
import { rawSql } from '../repo/raw-sql';
import { MATERIALIZE_JOB } from './materialize';
import type { ReconcileDeps } from './reconcile';
import type { ResumeOnQuotaDeps } from './resume-on-quota';
import type { SchedulerDeps } from './scheduler';
import type { WatchdogDeps } from './watchdog';

/**
 * Kompoziční kořen SYSTÉMOVÝCH úloh domény kampaní.
 *
 * Doplňuje `deps.ts`, který skládá `campaign.materialize`. Rozdíl mezi oběma
 * soubory je jediný a je to celý ten problém, kvůli kterému tenhle soubor
 * vznikl: materializace dostane ID projektu V NÁKLADU úlohy, kdežto tyhle
 * úlohy si ho musí najít samy NAPŘÍČ instalací, a to aplikační role neumí.
 *
 * Skladba je proto vždycky dvoutaktní a ten postup je závazný:
 *
 *   1. Sken pod rolí `mlain_maintenance` (`platform/maintenance-scan.ts`) vrátí
 *      IDENTIFIKÁTORY, a nic víc. Ta role má výjimku z izolace projektů jen na
 *      `workspaces`, `campaigns` a `sender_domains`.
 *   2. Veškerá další práce běží pod `mlain_app` v systémovém kontextu toho
 *      jednoho projektu, takže na ni dopadá RLS úplně stejně jako na požadavek
 *      z API.
 *
 * Kdo sem přidá čtení dat přes `withMaintenance`, obchází izolaci projektů.
 * Správná odpověď na „potřebuju k tomu ještě kontakty" je vzít ID projektu
 * a načíst si je přes `withWorkspace`.
 *
 * `loadConfig()` se volá VÝHRADNĚ uvnitř funkcí, ze stejného důvodu jako
 * v `deps.ts`: na úrovni modulu by shodila každý jednotkový test, který se
 * souboru jen dotkne.
 */

/** Kontext jednoho projektu pro systémovou úlohu. */
function ctxFor(workspaceId: string, job: string): WorkspaceContext {
  return createSystemContext(workspaceId, job);
}

/**
 * Odchozí událost projektu.
 *
 * Zápis do `webhook_events` a zařazení fan-outu jde v JEDNÉ transakci. Bez
 * zařazení by událost v tabulce ležela a nikdo by ji nerozeslal: `fanoutEvent`
 * volá výhradně job `platform.webhook_fanout` a ten se sám nezařadí.
 *
 * Je to táž skladba jako `emitEvent` v `deps.ts`. Sdílet se nedá, aniž by se
 * jeden z obou souborů stal závislostí druhého; obě kopie jsou pod jedním
 * testem, který ověřuje, že se událost i job doopravdy zapsaly.
 */
async function emitEvent(
  ctx: WorkspaceContext,
  input: { type: string; data: Record<string, unknown> },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const eventId = await emitWebhookEvent(tx, {
      workspaceId: ctx.workspaceId,
      type: input.type,
      occurredAt: new Date(),
      data: input.data,
    });
    await enqueueCampaignJob(tx, 'platform.webhook_fanout', {
      event_id: eventId,
      workspace_id: ctx.workspaceId,
    });
  });
}

/** Auditní řádek systémové úlohy. Aktér je `system`, protože ho nevyvolal člověk. */
async function writeSystemAudit(
  ctx: WorkspaceContext,
  input: {
    action: (typeof CampaignAuditActions)[keyof typeof CampaignAuditActions];
    campaignId: string;
    job: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await withWorkspace(ctx, (tx) =>
    writeAuditLog(tx, {
      action: input.action,
      workspaceId: ctx.workspaceId,
      actor: { actorType: 'system', actorId: null, actorLabel: input.job },
      targetType: 'campaign',
      targetId: input.campaignId,
      metadata: input.detail ?? {},
    }),
  );
}

/**
 * Závislosti jobu `campaign.scheduler`.
 *
 * Jediná úloha, na které je vidět celý dopad chybějící role: bez ní vrátí
 * `listWorkspaces()` prázdný seznam, cyklus se ani nerozběhne a NAPLÁNOVANÁ
 * KAMPAŇ SE NIKDY NEODEŠLE. Úloha přitom skončí úspěchem, protože prázdný
 * seznam je platný výsledek.
 */
export function systemSchedulerDeps(): SchedulerDeps {
  const catchupHours = loadConfig().CAMPAIGN_SCHEDULE_CATCHUP_HOURS;
  const job = 'campaign.scheduler';

  return {
    listWorkspaces: () => listWorkspaceIds(),

    claimDue: (workspaceId) =>
      claimDueCampaignRows(ctxFor(workspaceId, job), { catchupHours, limit: 100 }),

    markMissed: (workspaceId) => markScheduleMissedIds(ctxFor(workspaceId, job), { catchupHours }),

    /**
     * Zařazení materializace, tedy okamžik, kdy se kampaň skutečně rozjede.
     *
     * `singletonKey` je POVINNÝ, ne opatrnost. Plánovač tiká každých 30 sekund
     * a kampaň zůstává ve stavu `scheduled`, dokud materializace nepřepne stav
     * na `queueing`. Mezi zařazením a převzetím úlohy je tedy okno, ve kterém
     * ji další tik najde znovu; bez klíče by vznikly dvě úlohy na tutéž kampaň.
     * Klíč se bere z `MATERIALIZE_JOB`, aby byl týž jako na cestě z API.
     */
    sendMaterialize: async ({ workspaceId, campaignId }) => {
      const ctx = ctxFor(workspaceId, job);
      await withWorkspace(ctx, (tx) =>
        enqueueCampaignJob(
          tx,
          MATERIALIZE_JOB.queue,
          { workspaceId, campaignId },
          { singletonKey: MATERIALIZE_JOB.singletonKey(campaignId) },
        ),
      );
    },

    emit: ({ workspaceId, type, campaignId, data }) =>
      emitEvent(ctxFor(workspaceId, job), {
        type,
        data: { campaign_id: campaignId, ...((data as Record<string, unknown>) ?? {}) },
      }),

    audit: ({ workspaceId, action, campaignId, detail }) =>
      writeSystemAudit(ctxFor(workspaceId, job), {
        action: auditAction(action),
        campaignId,
        job,
        detail: (detail as Record<string, unknown>) ?? {},
      }),

    now: () => new Date(),
  };
}

/**
 * Překlad názvu akce na registrovanou auditní akci.
 *
 * Handlery si názvy nesou jako holé řetězce, protože nemají znát typ z domény
 * auditu. Neznámý název se hlásí VÝJIMKOU a ne tichým přeskočením: audit, který
 * občas chybí, je horší než audit, který spadne, protože se na něj nedá
 * spolehnout ani zpětně.
 */
function auditAction(
  name: string,
): (typeof CampaignAuditActions)[keyof typeof CampaignAuditActions] {
  const known = CampaignAuditActions as Record<
    string,
    (typeof CampaignAuditActions)[keyof typeof CampaignAuditActions] | undefined
  >;
  const action = known[name];
  if (action === undefined) {
    throw new Error(
      `Auditní akce "${name}" není v CampaignAuditActions. Doplň ji do campaigns/audit.ts, ` +
        'jinak se ten záznam do audit_log nikdy nezapíše.',
    );
  }
  return action;
}

/**
 * Závislosti jobu `campaign.watchdog`.
 *
 * Hlídač je jediné místo, které kampaň UZAVÍRÁ. Bez výčtu napříč projekty by
 * kampaň zůstala navždy ve stavu `sending`, i kdyby byla dávno celá odeslaná.
 */
export function systemWatchdogDeps(): WatchdogDeps {
  const config = loadConfig();
  const job = 'campaign.watchdog';

  return {
    listRunning: () => listRunningCampaigns(),

    reconcileHandover: (workspaceId, campaignId) =>
      reconcileHandoverCounters(ctxFor(workspaceId, job), campaignId),

    reconcileDelivery: (workspaceId, campaignId) =>
      reconcileDeliveryCounters(ctxFor(workspaceId, job), campaignId),

    /**
     * Čítače se čtou z kampaně, ne přepočtem z `messages`. Přepočet se právě
     * udělal o dva řádky výš v `reconcileHandover`, takže druhý by byl jen
     * dražší způsob, jak dostat totéž číslo.
     *
     * `lastChangeAt` je ale POSLEDNÍ ZMĚNA ZPRÁV, ne `campaigns.updated_at`,
     * a je to opravená chyba, ne detail. Hlídač si o čítače řekne AŽ POTOM, co
     * je sám přepočítal, a ten přepočet je bezpodmínečný `UPDATE campaigns`,
     * takže `updated_at` posune při každém tiku. Klidové okno
     * `WATCHDOG_QUIET_SECONDS` by tedy nikdy neuplynulo a kampaň by se
     * NEUZAVŘELA NIKDY. Ověřeno spuštěním: s `campaigns.updated_at` zůstala
     * doposlaná kampaň ve stavu `sending`, s časem z outboxu se uzavře.
     *
     * Náhradní hodnota při prázdném outboxu je `started_at` kampaně: kampaň bez
     * jediné zprávy se uzavírá jako `failed` a čekat na změnu, která nemá kde
     * vzniknout, by ji nechalo viset.
     */
    counters: async (workspaceId, campaignId) => {
      const ctx = ctxFor(workspaceId, job);
      const row = await withWorkspace(ctx, async (tx) => {
        const r = await tx.execute<{
          total_count: number;
          sent_count: number;
          failed_count: number;
          skipped_count: number;
          last_change_at: string | Date;
        }>(
          rawSql(
            `SELECT c.total_count, c.sent_count, c.failed_count, c.skipped_count,
                    COALESCE(
                      (SELECT max(m.updated_at) FROM messages m
                        WHERE m.campaign_id = c.id AND m.workspace_id = c.workspace_id
                          AND m.kind = 'campaign'),
                      c.started_at, c.created_at) AS last_change_at
               FROM campaigns c WHERE c.id = $1 AND c.workspace_id = $2`,
            [campaignId, ctx.workspaceId],
          ),
        );
        return r.rows[0] ?? null;
      });
      if (row === null) {
        // Kampaň zmizela mezi skenem a čtením. Nula znamená „není co uzavírat";
        // `closingStatus` z toho udělá `failed`, jenže `close()` níž nenajde
        // řádek k přechodu, takže se nestane nic. To je správně: mazání kampaně
        // je jiná cesta a hlídač do ní nemá zasahovat.
        return { total: 0, sent: 0, failed: 0, skipped: 0, lastChangeAt: new Date() };
      }
      return {
        total: row.total_count,
        sent: row.sent_count,
        failed: row.failed_count,
        skipped: row.skipped_count,
        lastChangeAt: new Date(row.last_change_at),
      };
    },

    drained: (workspaceId, campaignId, audienceBuiltAt) =>
      isOutboxDrained(ctxFor(workspaceId, job), { campaignId, audienceBuiltAt }),

    close: async (workspaceId, campaignId, status) => {
      const row = await transitionStatus(ctxFor(workspaceId, job), {
        campaignId,
        to: status,
        from: ['queueing', 'sending'],
        set: { finished_at: new Date() },
      });
      return row !== null;
    },

    /**
     * Byl už audit pro TUHLE pauzu?
     *
     * Rozlišovačem je časové razítko z `pause_reason.at`, ne existence jakéhokoli
     * dřívějšího záznamu: kampaň se dá pozastavit a rozjet opakovaně a každá
     * pauza je vlastní událost. Bez razítka by se zapsala jen ta první.
     */
    hasAuditForPause: async (workspaceId, campaignId, at) => {
      const ctx = ctxFor(workspaceId, job);
      const found = await withWorkspace(ctx, async (tx) => {
        const r = await tx.execute<{ n: number }>(
          rawSql(
            `SELECT count(*)::int AS n FROM audit_log
              WHERE workspace_id = $1 AND target_type = 'campaign' AND target_id = $2
                AND action = 'campaign.auto_paused'
                AND metadata ->> 'at' = $3`,
            [ctx.workspaceId, campaignId, at],
          ),
        );
        return r.rows[0]?.n ?? 0;
      });
      return found > 0;
    },

    writeAutoPauseAudit: (workspaceId, campaignId, reason) =>
      writeSystemAudit(ctxFor(workspaceId, job), {
        action: CampaignAuditActions['campaign.auto_paused'],
        campaignId,
        job,
        detail: { ...(reason as unknown as Record<string, unknown>) },
      }),

    emit: ({ workspaceId, type, campaignId }) =>
      emitEvent(ctxFor(workspaceId, job), { type, data: { campaign_id: campaignId } }),

    now: () => new Date(),
    partialThreshold: config.CAMPAIGN_PARTIAL_THRESHOLD,
  };
}

/** Závislosti jobu `campaign.resume_on_quota`. */
export function systemResumeOnQuotaDeps(): ResumeOnQuotaDeps {
  const config = loadConfig();
  const job = 'campaign.resume_on_quota';

  return {
    listPaused: () => listPausedOnQuota(),

    /**
     * Zbývající kvóta odesílacího účtu.
     *
     * Kampaň bez odesílacího účtu vrací NULU, tedy „neobnovovat". Vypadá to
     * jako past na věčně stojící kampaň, ale opak je pravdou: pauzu s kódem
     * `provider_quota_exhausted` zapisuje sender, který vždycky ví, přes který
     * účet posílal, takže prázdné `provider_id` znamená ručně upravený řádek.
     * Rozjet kampaň naslepo by ji poslalo do téže zdi a druhá pauza by přepsala
     * důvod té první.
     */
    remainingQuota: async (workspaceId, providerId) => {
      if (providerId === null) return 0;
      const provider = await getProviderById(ctxFor(workspaceId, job), providerId);
      if (provider === null) return 0;
      return quotaRemaining(provider);
    },

    resume: (workspaceId, campaignId) => resumeCampaign(ctxFor(workspaceId, job), campaignId),

    emit: ({ workspaceId, type, campaignId }) =>
      emitEvent(ctxFor(workspaceId, job), { type, data: { campaign_id: campaignId } }),

    quotaResumeAbove: config.CAMPAIGN_QUOTA_RESUME_REMAINING,
  };
}

/**
 * Závislosti jobu `outbox.reconcile`.
 *
 * Fronta se jmenuje `outbox.*`, takže její obsluha nepatří do rejstříku téhle
 * domény (codegen ji hledá podle adresáře). Továrna tu přesto je, protože
 * `reconcileHandler` bydlí v `campaigns/jobs/reconcile.ts` a chybějící část
 * byla i tady jediná: výčet projektů.
 *
 * `reconcile` zatím nemá kde vzít samotný úklid: `revokePending` pracuje nad
 * jednou kampaní, ne nad projektem. Tahle továrna proto vzniká AŽ SPOLU s ním
 * a do té doby je poctivější mít frontu vedenou jako nedodanou. Zbytek téhle
 * poznámky je návod, ne omluva: až ten úklid vznikne, doplní se sem funkce
 * `reconcile(workspaceId)` a továrna je hotová.
 */
export type OutboxReconcileScan = Pick<ReconcileDeps, 'listWorkspaces'>;

/** Ta polovina závislostí `outbox.reconcile`, která už dodat jde. */
export function systemReconcileScan(): OutboxReconcileScan {
  return { listWorkspaces: () => listWorkspaceIds() };
}
