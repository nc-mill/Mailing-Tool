import {
  applyPartitionPlan,
  ensureUpcomingPartitions,
  planPartitionsBefore,
  type PartitionDecision,
  type PartitionVeto,
  type Queryable,
  type VetoResult,
} from '@mlain/db';
import { loadConfig } from '../config';

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
 * PROČ TO NEBĚŽÍ Z WORKERU. Odpojení oddílu je DDL. Worker běží pod
 * `mlain_app`, která schéma nevlastní a `ALTER TABLE ... DETACH PARTITION` jí
 * skončí na „permission denied". Dát jí kvůli jedné úloze právo měnit schéma
 * znamená, že kterákoli chyba v kterékoli obsluze jobu může zahodit tabulku.
 * Úklid proto běží jako příkaz CLI pod `DATABASE_URL_MIGRATOR`, ze stejného
 * plánovače a se stejnou rolí jako migrace.
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
 *  - `audit_log` má `AUDIT_RETENTION_MONTHS` a vlastní úklid po řádcích
 *    (`platform.cleanup_audit_log`). Ten běží pod aplikační rolí a funguje,
 *    takže ho tenhle příkaz nepřebírá.
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

async function listPartitions(client: Queryable): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relkind = 'p' AND c.relkind = 'r'`,
  );
  return rows.map((row) => row.relname);
}
