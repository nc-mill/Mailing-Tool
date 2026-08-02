import { needsDependencies, perJob } from '../../queues';
import { materializeDeps } from './deps';
import { materializeHandler, type MaterializeJobPayload } from './materialize';

/**
 * Vstupní bod, který hledá codegen workeru (P01, rozhodnutí D4).
 *
 * Jméno souboru i jméno exportu `handlers` jsou ZÁVAZNÁ: codegen globuje
 * `packages/core/src/<domena>/jobs/queue-handlers.ts` a generuje z něj
 * `import { handlers as hN } from '@mlain/core/<domena>/jobs'`. Pod jiným
 * jménem se soubor přeloží, testy projdou a fronty se zaregistrují BEZ OBSLUHY:
 * úloha se zařadí, nikdo si ji nevyzvedne a kampaň zůstane viset. Nic přitom
 * nespadne, worker jen vypíše při startu řádek, který nikdo nečte.
 *
 * O tom, KDE soubor leží, rozhoduje výhradně glob codegenu přes adresáře, ne
 * jméno fronty. Pomocná funkce `handlerModulePath` z registru tvrdí něco jiného
 * (odvozuje adresář z prefixu jména fronty, takže pro `campaign.materialize`
 * vrací `src/campaign/jobs`, tedy JEDNOTNÉ číslo), a pro tuhle doménu se tedy
 * míjí se skutečností: doména se jmenuje `campaigns`. Držet se jejího výsledku
 * by znamenalo založit druhou, poloprázdnou doménu `campaign` vedle skutečné.
 * Hlídá to test `__tests__/queue-handlers.test.ts`, který codegen doopravdy
 * spustí a v jeho výstupu hledá `@mlain/core/campaigns/jobs`.
 *
 * V mapě jsou proto jen fronty s prefixem `campaign.`. Ostatní fronty téhle
 * domény (`outbox.*`, `provider.*`, `domain.recheck`, `provider_event.*`,
 * `deliverability.rollup`, `retention.drop_message_partitions`) obsluhu nemají
 * a jsou i s důvodem vedené v `apps/worker/test/handler-coverage.test.ts`.
 *
 * Fronty samotné zakládá P01 dopředu, tady se k nim jen připojují obsluhy.
 */

/**
 * Obsluhy, které se v tomhle buildu složit NEDAJÍ, a proč.
 *
 * Není to výčet práce, na kterou se zapomnělo. Je to seznam míst, kde chybí
 * ZDROJ DAT, ne zápis. Každá položka je pojmenovaná tak, aby při první úloze
 * vysvětlila sama sebe; `needsDependencies` úlohu shodí nahlas, místo aby
 * fronta tiše stála.
 *
 * 1. PĚT CRONOVÝCH JOBŮ POTŘEBUJE VÝČET PROJEKTŮ NAPŘÍČ INSTALACÍ a ten pod
 *    aplikační rolí NEEXISTUJE. `campaign.scheduler` a `outbox.reconcile` mají
 *    `listWorkspaces()`, `campaign.watchdog` má `listRunning()`,
 *    `campaign.resume_on_quota` má `listPaused()` a `domain.recheck` má
 *    `listDue()`; všechny čtou přes hranici projektu.
 *
 *    Ověřeno spuštěním proti čerstvě zmigrované databázi: pod `mlain_app` bez
 *    nastaveného `mlain.workspace_id` vrátí `SELECT count(*) FROM workspaces`
 *    NULA a `SELECT count(*) FROM campaigns` taky NULA, přestože oba řádky
 *    v databázi jsou. Migrace 0004 dává `workspaces` jen politiky
 *    `ws_isolation_self` (podle `mlain.workspace_id`), `ws_member_visibility`
 *    (podle `mlain.user_id`) a `ws_insert_bootstrap`; `withoutContext` tedy
 *    nesplní ani jednu. Cross-workspace čtení má v migraci VÝHRADNĚ role
 *    `mlain_sender` přes `sender_bypass`, a tu worker nepoužívá.
 *
 *    Sken se strážcem podle vzoru `contacts/import/jobs/recover-stale.ts` by tu
 *    byl HORŠÍ než nedodaná obsluha: vypadal by jako zapojený job a při každém
 *    tiku by spadl na `cross_workspace_scan_blocked`, tedy na jiné příčině, než
 *    jaká to doopravdy je. Chybí rozhodnutí, kterou rolí smí worker číst napříč
 *    projekty; to je změna modelu oprávnění, ne dopsání továrny.
 *
 * 2. `provider.refresh_quota` má náklad s `workspaceId`, takže na výčet projektů
 *    nenaráží. Naráží na `ProviderSignals`: `deriveProviderStatus` chce osm
 *    signálů a job z nich čerstvě zjistí jen dva (`enforcementStatus`,
 *    `sendingEnabled` z odpovědi SES). Pro zbylých šest nemá repozitář ZDROJ:
 *    `sending_providers.verified_at` nikdo nikdy nenastaví, `setProviderStatus`
 *    nemá v produkčním kódu jediného volajícího a pro `snsConfirmed`
 *    ani `eventsFlowing` neexistuje sloupec ani tabulka. Dopočítat je znamená
 *    hádat, a job výsledek ZAPISUJE: špatně uhodnutý signál by přepnul zdravý
 *    odesílací účet na `unverified` nebo `verifying` a preflight by od té chvíle
 *    odmítal každé odeslání. Načtení kvóty samotné (`refreshQuota`
 *    v `providers/api/service.ts`) hotové je; chybí ta jedna mapovací funkce.
 */
const CROSS_WORKSPACE_SCAN =
  'výčet projektů napříč instalací (RLS pustí jen mlain_sender přes sender_bypass, worker jede pod mlain_app)';

export const handlers = {
  /**
   * Jediná fronta téhle domény, které se dá závislosti složit poctivě: náklad
   * nese `workspaceId`, takže z něj vznikne systémový kontext projektu a
   * všechno ostatní už v repozitáři je.
   *
   * `perJob` je POVINNÝ obal: pg-boss volá obsluhu s DÁVKOU úloh, kdežto
   * `materializeHandler` bere jednu. Bez obalu dostane pole, sáhne na `.data`
   * a dostane `undefined`. Fronta by se přitom zaregistrovala a worker naběhl,
   * takže by se to poznalo teprve na první skutečně zpracované úloze.
   */
  'campaign.materialize': perJob<MaterializeJobPayload>(async (job) => {
    await materializeHandler(materializeDeps(job.data), job.data);
  }),

  'campaign.scheduler': needsDependencies(
    'campaign.scheduler',
    `SchedulerDeps.listWorkspaces, tedy ${CROSS_WORKSPACE_SCAN}`,
  ),
  'campaign.watchdog': needsDependencies(
    'campaign.watchdog',
    `WatchdogDeps.listRunning, tedy ${CROSS_WORKSPACE_SCAN}`,
  ),
  'campaign.resume_on_quota': needsDependencies(
    'campaign.resume_on_quota',
    `ResumeOnQuotaDeps.listPaused, tedy ${CROSS_WORKSPACE_SCAN}`,
  ),
} as const;
