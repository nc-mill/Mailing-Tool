import { once, perJob } from '../../queues';
import { materializeDeps } from './deps';
import { materializeHandler, type MaterializeJobPayload } from './materialize';
import { reconcileHandler } from './reconcile';
import { resumeOnQuotaHandler } from './resume-on-quota';
import { schedulerHandler } from './scheduler';
import { stallWatchHandler } from './stall-watch';
import { watchdogHandler } from './watchdog';
import {
  systemReconcileDeps,
  systemResumeOnQuotaDeps,
  systemSchedulerDeps,
  systemStallWatchDeps,
  systemWatchdogDeps,
} from './system-deps';

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
 * V mapě jsou kromě front s prefixem `campaign.` i obě fronty `outbox.*`,
 * protože jejich obsluhy bydlí v tomhle adresáři. Zbylé fronty téhle domény
 * (`provider.*`, `domain.recheck`, `provider_event.*`, `deliverability.rollup`,
 * `retention.drop_message_partitions`) obsluhu nemají a jsou i s důvodem
 * vedené v `apps/worker/test/handler-coverage.test.ts`.
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
 * 1. VÝČET PROJEKTŮ NAPŘÍČ INSTALACÍ. Tohle rozhodnutí PADLO a tři ze čtyř
 *    cronových jobů téhle domény už na něm stojí: čte se rolí
 *    `mlain_maintenance` přes `DATABASE_URL_MAINTENANCE` (migrace 0009).
 *    Role má jmenovitou výjimku z izolace jen na `workspaces`, `campaigns`
 *    a `sender_domains`, a i tam vrací POUZE identifikátory. Jakmile má úloha
 *    ID projektu, pokračuje pod `mlain_app` v systémovém kontextu toho
 *    projektu a dopadá na ni RLS stejně jako na požadavek z API. Továrny jsou
 *    v `system-deps.ts`, izolaci hlídá `platform/__tests__/maintenance-scan.db.test.ts`.
 *
 *    Proč to nešlo pod `mlain_app`, ať se k tomu nikdo nevrací: ověřeno proti
 *    čerstvě zmigrované databázi, že bez nastaveného `mlain.workspace_id` vrátí
 *    `SELECT count(*) FROM workspaces` NULA a `campaigns` taky NULA, přestože
 *    oba řádky v databázi jsou. Migrace 0004 dává `workspaces` jen politiky
 *    `ws_isolation_self`, `ws_member_visibility` a `ws_insert_bootstrap`;
 *    `withoutContext` nesplní ani jednu, a ticho je horší než chyba.
 *
 *    `outbox.reconcile` na tomhle seznamu už NENÍ: chyběl jí `reconcile`,
 *    a ten je `reconcilePending`, jeden příkaz nad celým projektem. Nezapojená zůstává `domain.recheck`, jejíž sken `listDueDomains`
 *    sice hotový je, ale obsluha patří do jiného adresáře, takže ji tenhle
 *    rejstřík stejně nevezme.
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

  /**
   * Tři cronové skeny nad rolí `mlain_maintenance`.
   *
   * `once`, NE `perJob`, a je to podstatné. Všechny tři jedou z cronu
   * s prázdným nákladem, takže víc úloh v dávce znamená víc TIKŮ, ne víc práce.
   * `perJob` by sken spustil tolikrát, kolik je úloh v dávce, a druhý průchod
   * by nenašel nic; vypadalo by to jako správný běh, jen s trojnásobkem dotazů.
   */
  'campaign.scheduler': once(() => schedulerHandler(systemSchedulerDeps())),
  'campaign.watchdog': once(() => watchdogHandler(systemWatchdogDeps())),
  'campaign.resume_on_quota': once(() => resumeOnQuotaHandler(systemResumeOnQuotaDeps())),

  /**
   * `outbox.reconcile` má jiný prefix než zbytek téhle mapy, a je to schválně.
   * Obsluha `reconcileHandler` leží v `campaigns/jobs/reconcile.ts`, tedy v týhle
   * doméně; `handlerModulePath` by ji podle prefixu jména poslala do
   * `src/outbox/jobs`, což je adresář, který neexistuje a existovat nemá.
   * O umístění rozhoduje glob codegenu přes adresáře, ne jméno fronty, takže
   * klíč patří sem.
   *
   * Zapsaný je proto, aby se o něm vědělo NAHLAS: dřív byl vedený jen v
   * `handler-coverage.test.ts`, takže se cronový tik každou minutu zařadil do
   * fronty, ze které nikdo nečetl, a nikde se to neprojevilo.
   *
   * Obsluha je teď složená celá, viz `systemReconcileDeps()`. Předchozí znění
   * téhle poznámky tvrdilo, že druhou polovinu složit nejde, protože
   * `revokePending` pracuje nad kampaní; to byl omyl. Chybějící kus je
   * `reconcilePending`, jeden příkaz nad celým projektem. Zdůvodnění, proč
   * záchytná cesta dává smysl i po zapojení té okamžité, je u té továrny.
   *
   * `once`, ne `perJob`, ze stejného důvodu jako u skenů výš: cron s prázdným
   * nákladem, takže víc úloh v dávce znamená víc tiků, ne víc práce.
   */
  'outbox.reconcile': once(() => reconcileHandler(systemReconcileDeps())),

  /**
   * Hlídač zaseknutých dávek. Prefix `outbox.` je tu ze stejného důvodu jako
   * u `outbox.reconcile` níž: obsluha bydlí v `campaigns/jobs/stall-watch.ts`,
   * a o umístění rozhoduje adresář, ne jméno fronty.
   *
   * `once`, ne `perJob`: cron s prázdným nákladem, takže víc úloh v dávce
   * znamená víc tiků, ne víc práce. `perJob` by sken pustil tolikrát, kolik je
   * úloh v dávce, a druhý průchod by nahlásil tytéž kampaně znovu.
   *
   * Na rozdíl od `outbox.reconcile` se tahle složit dá celá: výčet projektů
   * i běžících kampaní `platform/maintenance-scan.ts` umí a zbytek je jeden
   * dotaz nad `messages` v kontextu jednoho projektu.
   */
  'outbox.stall_watch': once(() => stallWatchHandler(systemStallWatchDeps())),
} as const;
