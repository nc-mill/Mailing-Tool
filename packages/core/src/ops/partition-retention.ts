import {
  applyPartitionPlan,
  ensureUpcomingPartitions,
  planPartitionsBefore,
  type PartitionDecision,
  type PartitionVeto,
  type Queryable,
  type VetoResult,
} from '@mlain/db';
import { writeAuditLog } from '../audit/write';
import { loadConfig } from '../config';
import type { Tx } from '../tx';
import { OPS_AUDIT_ACTIONS } from './audit';
import { withAdminTx } from './db';

/**
 * RETENCE ODESLANÉ POŠTY. Dřív v produktu nebyla vůbec.
 *
 * Stav před touhle prací: `dropPartitionsBefore()` existovala bez jediného
 * volajícího, fronty `retention.drop_message_partitions`
 * a `tracking.enforce_retention` byly v registru bez obsluhy
 * a `MESSAGE_RETENTION_DAYS` se v běhovém kódu nečetla. Instalace tedy držela
 * `messages.render_data`, tedy personalizační data příjemce, NAVĚKY.
 * To je hlavní důvod téhle práce; velikost databáze je vedlejší.
 *
 * POD JAKOU ROLÍ TO BĚŽÍ, A PROČ TO NENÍ PRÁCE PRO `mlain_app`. Odpojení oddílu
 * je DDL. Role `mlain_app`, pod kterou jede worker i web, schéma nevlastní
 * a `ALTER TABLE ... DETACH PARTITION` jí skončí na „permission denied". Dát
 * JÍ právo měnit schéma nepřipadá v úvahu: pak by kterákoli chyba v kterékoli
 * obsluze mohla zahodit tabulku. Úklid proto vždycky otevírá VLASTNÍ spojení
 * pod `DATABASE_URL_MIGRATOR`, tedy pod toutéž rolí jako `mlain migrate`.
 *
 * ODKUD SE PŘÍKAZ POUŠTÍ (změna 7. 8. 2026). Do téhle chvíle to uměl JEDINĚ
 * `mlain partitions` z plánovače hostitele. Znamenalo to, že dodávaná
 * instalace úklid nespouštěla vůbec: `docker/compose.yml` ani `compose.scale.yml`
 * žádný plánovač nemají a na PaaS k hostiteli přístup není. Každá instalace
 * z našeho compose tedy držela `messages.render_data` navěky a `mlain doctor`
 * by jí to hlásil napořád. Práci proto dělá i cronová fronta
 * `platform.maintain_partitions` ve workeru (`ops/jobs/partition-jobs.ts`).
 *
 * NENÍ TO DRUHÝ MECHANISMUS, je to tentýž kód puštěný z jiného místa: obě
 * cesty volají `maintainPartitions()` níž, tedy tutéž funkci, totéž spojení
 * pod migrátorem a týž zápis do auditu. Liší se jen popiskem aktéra, aby se
 * z auditu poznalo, která z nich běžela. Že job smí sáhnout na migrátorské
 * URL, není nová výjimka: `platform.backup` pod ním ve workeru běží od P16,
 * protože pod aplikační rolí by `pg_dump` narazil na row level security.
 *
 * PROČ PO ODDÍLECH, NE PO ŘÁDCÍCH. Mazání po řádcích nad tabulkou s miliony
 * zpráv znamená dlouhou transakci, nafouknutí tabulky a autovacuum, který to
 * dohání celý den. Odpojení oddílu je katalogová operace: proběhne v řádu
 * milisekund bez ohledu na to, kolik řádků oddíl nese.
 *
 * CO Z TOHO PLYNE PRO LHŮTU. Retence má reálně MĚSÍČNÍ granularitu, protože
 * hranice oddílu je začátek měsíce. `MESSAGE_RETENTION_DAYS=90` tedy drží
 * 90 až 120 dní, ne přesně 90: srpnový oddíl smí zmizet nejdřív, když je
 * i 31. srpen starší než 90 dní. Nikdy se nemaže dřív, než lhůta uplyne,
 * vždycky případně později. Je to napsané u proměnné v konfiguraci
 * i v provozní dokumentaci, protože jinak to překvapí.
 */

/** Jeden cíl úklidu: partitionovaná tabulka, její lhůta a její veto. */
export type RetentionTarget = {
  table: string;
  column: string;
  /** Jméno proměnné, která lhůtu řídí. Vypisuje se, aby šlo dohledat, co změnit. */
  setting: string;
  /** Lhůta v lidské podobě do výpisu, například „90 dní" nebo „37 měsíců". */
  window: string;
  /** Okamžik, před kterým smí oddíl zmizet. */
  cutoff: Date;
  veto: PartitionVeto;
};

function minusDays(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Odečtení měsíců přes UTC složky, ne přes milisekundy. Měsíc nemá pevnou
 * délku, takže `- 37 * 30 * den` by u `TRACKING_RETENTION_MONTHS` ukrojilo
 * skoro měsíc navíc a smazalo data, která ještě měla žít.
 *
 * Den se OŘEZÁVÁ na poslední den cílového měsíce, a je to podstatné.
 * `Date.UTC(2025, 1, 31)` znamená 3. březen, protože únor 31. den nemá,
 * takže 31. března minus 13 měsíců by vyšlo na 3. 3. 2025 místo 28. 2. 2025.
 * Hranice by se posunula DOPŘEDU, a protože se maže všechno, co končí před ní,
 * zahodil by se navíc celý únorový oddíl. Chyba jedním směrem znamená data
 * navíc v databázi, druhým směrem předčasně smazaná data; tohle je ten druhý
 * směr. Odhaleno testem, ne úvahou.
 */
function minusMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() - months;
  // Den 0 dalšího měsíce je poslední den měsíce cílového.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDayOfTarget),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Veto pro `messages`. Jediné netriviální v celém úklidu.
 *
 * PAST INVARIANTU I1. Všechny zprávy jedné kampaně mají `created_at` rovné
 * `campaigns.audience_built_at`, takže CELÁ kampaň leží v JEDNOM oddílu
 * vybraném při materializaci publika. Kampaň materializovaná 31. srpna má
 * všechny zprávy v srpnovém oddílu, i když se dorozesílá v listopadu. Kdyby
 * úklid koukal jen na stáří oddílu, vzal by pozastavené kampani outbox pod
 * rukama a ta by se po obnovení tvářila jako doběhlá, přestože neodeslala nic.
 *
 * Proto se ptáme na dvě věci a stačí, aby platila jedna, a oddíl zůstává:
 *
 *  1. Leží v oddílu zpráva ve stavu `pending` nebo `claimed`? To jsou jediné
 *     dva nekoncové stavy (`sent`, `failed` a `skipped` jsou koncové). Oba
 *     dotazy míří přesně na predikát částečného indexu (`idx_messages__claimable`
 *     pro `pending`, `idx_messages__stuck` pro `claimed`), takže i nad oddílem
 *     s miliony řádků skončí na prvním nalezeném záznamu.
 *  2. Má některá kampaň `audience_built_at` uvnitř rozsahu oddílu a přitom
 *     ještě nedoběhla? Odpovídá na případ, kdy kampaň zprávy teprve dostane,
 *     nebo kdy je má všechny koncové, ale běh jako celek se ještě uzavírá.
 *
 * Druhá otázka je schválně širší než první. Kdyby se ptala jen na zprávy,
 * prošla by kampaň ve stavu `queueing`, která má publikum spočítané, ale
 * řádky ještě nezaložené.
 */
const messagesVeto: PartitionVeto = async (client, from, to, partition) => {
  if (!IDENT.test(partition)) {
    return { keep: `jméno oddílu ${partition} neprošlo kontrolou identifikátoru` };
  }

  const pending = await client.query<{ present: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${partition} WHERE status = 'pending') AS present`,
  );
  if (pending.rows[0]!.present) {
    return { keep: 'leží v něm nerozeslané zprávy ve stavu pending' };
  }

  const claimed = await client.query<{ present: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${partition} WHERE status = 'claimed') AS present`,
  );
  if (claimed.rows[0]!.present) {
    return { keep: 'leží v něm zprávy zabrané senderem ve stavu claimed' };
  }

  const campaigns = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM campaigns
      WHERE audience_built_at >= $1 AND audience_built_at < $2
        AND status NOT IN ('sent', 'partially_sent', 'cancelled', 'failed', 'schedule_missed')
      LIMIT 1`,
    [from.toISOString(), to.toISOString()],
  );
  const stuck = campaigns.rows[0];
  if (stuck) {
    return { keep: `kampaň ${stuck.id} v něm má publikum a je ve stavu ${stuck.status}` };
  }

  return true;
};

/**
 * Veto pro append only tabulky událostí.
 *
 * `message_events` a `web_events` nikdo nepřepisuje a žádný běžící proces se
 * k nim nevrací: odraz od providera i webová událost se zapíšou jednou
 * a dál se jen čtou. Hranice oddílu je tedy jediná podmínka, kterou je
 * potřeba splnit.
 *
 * Predikát je přesto POVINNÝ argument a je tu napsaný výslovně, ne obejitý
 * `undefined`. Rozdíl mezi „na tuhle tabulku se nic dalšího ptát nemusí"
 * a „na tuhle tabulku se nikdo ptát nezačal" se z chybějícího argumentu
 * nepozná, a je to rozdíl mezi správným úklidem a ztrátou dat.
 */
const appendOnlyVeto: PartitionVeto = async (): Promise<VetoResult> => true;

/**
 * Cíle úklidu se skládají z konfigurace, ne z konstant v kódu.
 *
 * VĚDOMĚ TU NEJSOU všechny partitionované tabulky. Úklid dostane jen tabulka,
 * která má svou vlastní konfigurační proměnnou, protože lhůta bez proměnné je
 * jen číslo, které si někdo vymyslel, a provozovatel ho nemá jak změnit:
 *
 *  - `inbound_deliveries` spadá pod projektovou retenci `retention.run`
 *    (`RETENTION_DEFAULTS.inbound_deliveries`), která maže po řádcích, protože
 *    lhůtu si nastavuje každý projekt zvlášť a oddíl je společný všem.
 *  - `webhook_events`, `webhook_deliveries`, `provider_event_receipts`
 *    a `message_engagement` žádnou retenční proměnnou nemají. Domýšlet jim ji
 *    tady by znamenalo mazat data podle čísla, které nikde není napsané.
 */
export function retentionTargets(now: Date, env?: NodeJS.ProcessEnv): RetentionTarget[] {
  const config = loadConfig(env);
  return [
    {
      table: 'messages',
      column: 'created_at',
      setting: 'MESSAGE_RETENTION_DAYS',
      window: `${config.MESSAGE_RETENTION_DAYS} dní`,
      cutoff: minusDays(now, config.MESSAGE_RETENTION_DAYS),
      veto: messagesVeto,
    },
    {
      table: 'message_events',
      column: 'received_at',
      setting: 'MESSAGE_EVENT_RETENTION_DAYS',
      window: `${config.MESSAGE_EVENT_RETENTION_DAYS} dní`,
      cutoff: minusDays(now, config.MESSAGE_EVENT_RETENTION_DAYS),
      veto: appendOnlyVeto,
    },
    {
      table: 'web_events',
      column: 'received_at',
      setting: 'TRACKING_RETENTION_MONTHS',
      window: `${config.TRACKING_RETENTION_MONTHS} měsíců`,
      cutoff: minusMonths(now, config.TRACKING_RETENTION_MONTHS),
      veto: appendOnlyVeto,
    },
    /**
     * AUDIT SE UKLÍZÍ ZAHOZENÍM ODDÍLU, NE MAZÁNÍM ŘÁDKŮ, a je to bezpečnostní
     * rozhodnutí, ne provozní pohodlí.
     *
     * Do 7. 8. 2026 to dělala fronta `platform.cleanup_audit_log` příkazem
     * `DELETE FROM audit_log` pod aplikační rolí. Nefungovalo to ANI JEDNOU:
     * migrace 0005, 0009, 0022 i 0026 dělají `REVOKE UPDATE, DELETE ON audit_log
     * FROM mlain_app`, takže úloha padala každou noc na
     * `permission denied for table audit_log` (SQLSTATE 42501). Ověřeno spuštěním.
     *
     * To odebrané právo NENÍ překážka, kterou by šlo obejít migrací. Je to ta
     * vlastnost, kvůli které je audit k něčemu: aplikace do něj smí zapisovat
     * a nesmí z něj mazat ani v něm měnit. Vrátit roli `DELETE` kvůli úklidu by
     * vyměnilo nevyvratitelnost záznamu za pohodlí. Zahození celého oddílu pod
     * migrátorem udělá touž práci a záruku nechá být.
     *
     * Vedlejší důsledek je žádoucí a odpovídá tomu, co o téhle lhůtě tvrdil
     * registr front: audit se drží DÉLE než `AUDIT_RETENTION_MONTHS`, nikdy
     * kratší dobu, protože oddíl smí zmizet až tehdy, když je za lhůtou i jeho
     * poslední den.
     */
    {
      table: 'audit_log',
      column: 'created_at',
      setting: 'AUDIT_RETENTION_MONTHS',
      window: `${config.AUDIT_RETENTION_MONTHS} měsíců`,
      cutoff: minusMonths(now, config.AUDIT_RETENTION_MONTHS),
      veto: appendOnlyVeto,
    },
    /**
     * AUDIT SE UKLÍZÍ ZAHOZENÍM ODDÍLU, NE MAZÁNÍM ŘÁDKŮ, a je to bezpečnostní
     * rozhodnutí, ne provozní pohodlí.
     *
     * Do 7. 8. 2026 to dělala fronta `platform.cleanup_audit_log` příkazem
     * `DELETE FROM audit_log` pod aplikační rolí. Nefungovalo to ANI JEDNOU:
     * migrace 0005, 0009, 0022 i 0026 dělají `REVOKE UPDATE, DELETE ON audit_log
     * FROM mlain_app`, takže úloha padala každou noc na
     * `permission denied for table audit_log` (SQLSTATE 42501). Ověřeno spuštěním.
     *
     * To odebrané právo NENÍ překážka, kterou by šlo obejít migrací. Je to ta
     * vlastnost, kvůli které je audit k něčemu: aplikace do něj smí zapisovat
     * a nesmí z něj mazat ani v něm měnit. Vrátit roli `DELETE` kvůli úklidu by
     * vyměnilo nevyvratitelnost záznamu za pohodlí. Zahození celého oddílu pod
     * migrátorem udělá touž práci a záruku nechá být.
     *
     * Vedlejší důsledek je žádoucí a odpovídá tomu, co o téhle lhůtě tvrdí
     * registr front: audit se drží DÉLE než `AUDIT_RETENTION_MONTHS`, nikdy
     * kratší dobu, protože oddíl smí zmizet až tehdy, když je za lhůtou i jeho
     * poslední den.
     */
  ];
}

export type TargetReport = {
  table: string;
  setting: string;
  window: string;
  cutoff: Date;
  decisions: PartitionDecision[];
  /** Co se skutečně zahodilo. V režimu nanečisto vždy prázdné. */
  dropped: string[];
};

export type RetentionReport = {
  dryRun: boolean;
  created: string[];
  targets: TargetReport[];
};

export type RunInput = {
  client: Queryable;
  now?: Date;
  dryRun?: boolean;
  /** Kolik měsíců dopředu se zakládají oddíly. Migrační runner používá 4. */
  ensureMonths?: number;
  env?: NodeJS.ProcessEnv;
};

/**
 * Jeden běh údržby oddílů: dopředu založit, dozadu uklidit.
 *
 * OBOJÍ V JEDNOM PŘÍKAZU je záměr. Jsou to dvě strany téhož: bez zakládání
 * dopředu přestane instalace po čtyřech měsících přijímat zápisy, protože
 * výchozí oddíl se schválně nezakládá a zápis mimo okno tvrdě selže. Dva
 * příkazy by znamenaly dva záznamy v plánovači a možnost pustit jen jeden
 * z nich; přesně tenhle druh polovičního zapojení tady odstraňujeme.
 *
 * `client` MUSÍ být spojení MIMO transakci. `ALTER TABLE ... DETACH PARTITION
 * CONCURRENTLY` uvnitř transakčního bloku skončí chybou 25001, a bez
 * CONCURRENTLY by odpojení vzalo ACCESS EXCLUSIVE zámek na celou tabulku,
 * tedy zastavilo claim i příjem událostí na dobu běhu.
 */
export async function runPartitionMaintenance(input: RunInput): Promise<RetentionReport> {
  const now = input.now ?? new Date();
  const dryRun = input.dryRun ?? false;
  const targets = retentionTargets(now, input.env);

  // Zakládání dopředu jde první. Kdyby úklid spadl, chybějící budoucí oddíl
  // by shodil zápisy, což je vážnější porucha než neuklizená historie.
  let created: string[] = [];
  if (!dryRun) {
    const before = await listPartitions(input.client);
    await ensureUpcomingPartitions(input.client, now, input.ensureMonths ?? 4);
    const after = await listPartitions(input.client);
    created = after.filter((name) => !before.includes(name));
  }

  const reports: TargetReport[] = [];
  for (const target of targets) {
    const decisions = await planPartitionsBefore(
      input.client,
      target.table,
      target.cutoff,
      target.veto,
    );
    // Provádí se TÝŽ plán, který se vypsal. Kdyby si provedení rozhodnutí
    // počítalo znovu, mohl by se mezi výpisem a zásahem změnit stav zprávy
    // a zahodit se něco jiného, než co provozovatel viděl.
    const dropped = dryRun ? [] : await applyPartitionPlan(input.client, target.table, decisions);
    reports.push({
      table: target.table,
      setting: target.setting,
      window: target.window,
      cutoff: target.cutoff,
      decisions,
      dropped,
    });
  }

  return { dryRun, created, targets: reports };
}

/**
 * Počty z jednoho běhu v podobě, ve které se zapisují do auditu.
 *
 * Je to vlastní funkce, ne inline objekt, protože obsah metadat je to jediné,
 * co po běhu zůstane. Výpis do konzole zmizí s plánovačem hostitele.
 */
export function partitionMaintenanceMetadata(report: RetentionReport): Record<string, unknown> {
  const tables: Record<string, number> = {};
  let dropped = 0;
  for (const target of report.targets) {
    tables[target.table] = target.dropped.length;
    dropped += target.dropped.length;
  }
  return { created: report.created.length, dropped, tables };
}

/**
 * ZÁZNAM O TOM, ŽE ÚDRŽBA ODDÍLŮ PROBĚHLA.
 *
 * PROČ TO VŮBEC JE. `mlain partitions` je jediné místo, kde se uklízí odeslaná
 * pošta, a pouští ho plánovač hostitele. Po úspěšném běhu nezbylo NIC: výpis
 * spolkne plánovač, tabulky se jen zmenší a nikde není řádek, ze kterého by
 * šlo poznat, že běh proběhl. Provozovatel tedy neměl jak zjistit, že mu
 * retence týden neběžela a `messages.render_data` leží přes lhůtu. Na tenhle
 * záznam se dívá `mlain doctor`.
 *
 * PROČ SE ZAPISUJE I BĚH, KTERÝ NIC NEZAHODIL. Nula zahozených oddílů je
 * naprosto běžný a správný výsledek (lhůta ještě nikomu neuplynula). Zapisovat
 * jen běhy, které něco smazaly, by znamenalo, že správně fungující instalace
 * vypadá stejně jako instalace, kde úklid vůbec neběží.
 *
 * BĚH NANEČISTO SE NEZAPISUJE, a je to jediné, co tahle funkce odmítá. Zápis
 * o běhu, který schválně nic neudělal, by v doktoru vypadal jako doklad
 * o úklidu, tedy by uklidnil právě v okamžiku, kdy data leží přes lhůtu.
 */
export async function recordPartitionMaintenance(
  tx: Tx,
  report: RetentionReport,
  /**
   * Kdo úklid pustil. Dvě legitimní hodnoty: `mlain partitions` z plánovače
   * hostitele a `platform.maintain_partitions` z workeru. Doktoru je to jedno,
   * ptá se jen na akci, ale provozovateli ne: bez tohohle údaje se z auditu
   * nepozná, jestli mu úklid dělá worker, nebo jeho vlastní cron, a tedy ani
   * to, který z nich přestal běžet.
   */
  actorLabel: string = 'mlain partitions',
): Promise<void> {
  if (report.dryRun) {
    throw new Error(
      'Běh nanečisto se do auditu nezapisuje: nic nezahodil, a záznam o něm by v mlain doctor ' +
        'vypadal jako doklad o proběhlém úklidu.',
    );
  }
  await writeAuditLog(tx, {
    action: OPS_AUDIT_ACTIONS['partition.maintained'],
    // Údržba je operace nad celou instalací, ne nad projektem. `audit_log.workspace_id`
    // je nullable schválně a politika ws_isolation_audit má NULL ve WITH CHECK.
    workspaceId: null,
    actor: { actorType: 'system', actorId: null, actorLabel },
    targetType: 'partitions',
    targetId: null,
    metadata: partitionMaintenanceMetadata(report),
  });
}

export type MaintainPartitionsInput = {
  /** Vždy `DATABASE_URL_MIGRATOR`. Aplikační role tuhle práci udělat nemůže. */
  migratorUrl: string;
  dryRun?: boolean;
  ensureMonths?: number;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Popisek aktéra do auditu, viz `recordPartitionMaintenance`. */
  actorLabel: string;
};

export type MaintainPartitionsResult = {
  report: RetentionReport;
  /**
   * Chyba zápisu do auditu, když k ní došlo. NEVYHAZUJE se: úklid v tu chvíli
   * UŽ PROBĚHL a výjimka by o něm lhala. Co s ní volající udělá, je jeho věc
   * a u obou volajících je to jinak: CLI ji vypíše na chybový výstup, kam se
   * dívá plánovač hostitele, job ji vyhodí, protože ve workeru je jediné
   * viditelné místo tabulka úloh.
   */
  auditError: Error | null;
};

/**
 * CELÝ BĚH ÚDRŽBY OD PŘIPOJENÍ PO ZÁPIS DO AUDITU. Jediná verze pro obě cesty,
 * tedy pro `mlain partitions` i pro frontu `platform.maintain_partitions`.
 *
 * DVĚ SPOJENÍ, A JE TO ZÁMĚR. Samotný úklid běží přes holý `pg.Client` MIMO
 * transakci, protože `ALTER TABLE ... DETACH PARTITION CONCURRENTLY` uvnitř
 * transakčního bloku skončí chybou 25001. Audit se naproti tomu zapisuje
 * transakčně přes drizzle (`withAdminTx`). Dvě různé cesty k databázi tu tedy
 * nejsou nedopatření, jsou to dva různé požadavky na tutéž práci.
 *
 * AUDIT AŽ PO ÚKLIDU, ne v jedné transakci s ním. Odpojení oddílu je DDL mimo
 * transakci, takže „obojí, nebo nic" tady neexistuje. Pořadí je zvolené tak,
 * aby chyba padla na bezpečnou stranu: zapsat se dá jedině to, co se doopravdy
 * stalo.
 *
 * `pg` se načítá dynamicky. Statický import by přitáhl ovladač databáze do
 * každého balíčku, který na `@mlain/core/ops` jen sáhne, a týká se to i webu.
 */
export async function maintainPartitions(
  input: MaintainPartitionsInput,
): Promise<MaintainPartitionsResult> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: input.migratorUrl });
  await client.connect();
  let report: RetentionReport;
  try {
    report = await runPartitionMaintenance({
      client,
      dryRun: input.dryRun ?? false,
      ensureMonths: input.ensureMonths ?? 4,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.env === undefined ? {} : { env: input.env }),
    });
  } finally {
    await client.end().catch(() => undefined);
  }

  if (report.dryRun) return { report, auditError: null };
  try {
    await withAdminTx(input.migratorUrl, async (tx) => {
      await recordPartitionMaintenance(tx, report, input.actorLabel);
    });
    return { report, auditError: null };
  } catch (error) {
    return { report, auditError: error as Error };
  }
}

async function listPartitions(client: Queryable): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relkind = 'p' AND c.relkind = 'r'`,
  );
  return rows.map((row) => row.relname);
}
