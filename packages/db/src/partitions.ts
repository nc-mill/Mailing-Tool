// packages/db/src/partitions.ts
import type { Client, Pool } from 'pg';

export type Queryable = Pick<Client | Pool, 'query'>;

export type PartitionedTable = { table: string; column: string; owner: string };

/**
 * ÚPLNÝ registr partitionovaných tabulek. Kdo přidá partitionovanou tabulku
 * a nezapíše ji sem, dostane selhání zápisu od první minuty provozu, protože
 * výchozí partition je zakázaná. Test partitions.test.ts registr porovnává
 * s pg_partitioned_table, takže rozejít se nemůžou tiše.
 *
 * Partitioning sloupec MUSÍ být čas, který generujeme my. Nikdy ne `ts`
 * z message_events ani occurred_at z web_events: obojí dodává třetí strana
 * a hodnota mimo existující okno by zápis tvrdě položila.
 */
export const PARTITIONED_TABLES: readonly PartitionedTable[] = [
  { table: 'audit_log', column: 'created_at', owner: 'platform' },
  { table: 'webhook_events', column: 'created_at', owner: 'platform' },
  { table: 'webhook_deliveries', column: 'created_at', owner: 'platform' },
  { table: 'messages', column: 'created_at', owner: 'campaigns' },
  { table: 'message_events', column: 'received_at', owner: 'campaigns' },
  { table: 'provider_event_receipts', column: 'received_at', owner: 'campaigns' },
  { table: 'inbound_deliveries', column: 'created_at', owner: 'contacts' },
  { table: 'web_events', column: 'received_at', owner: 'tracking' },
  { table: 'message_engagement', column: 'created_at', owner: 'tracking' },
];

/**
 * ÚPLNÝ registr odkazů na partitionované tabulky (rozhodnutí R24).
 *
 * Každý odkaz musí nést OBĚ složky složeného klíče, jinak dohledání projde
 * všechny oddíly. `WHERE id = $1` vypadá jako správný dotaz a chová se špatně
 * teprve na objemu dat, tedy až u zákazníka.
 *
 * Test partitions.test.ts porovnává tenhle registr s information_schema,
 * takže nový odkaz bez druhé složky spadne v CI. Dokud se test řídil
 * jmenovitým výčtem, chyběly obě položky níž a nikdo si toho nevšiml.
 */
export type PartitionedReference = {
  from: string;
  /** Sloupec s první složkou klíče. */
  column: string;
  to: string;
  /** Sloupec s druhou složkou, tedy s partičním klíčem cílové tabulky. */
  secondColumn: string;
  nullable?: boolean;
};

export const PARTITIONED_REFERENCES: readonly PartitionedReference[] = [
  {
    from: 'message_events',
    column: 'message_id',
    to: 'messages',
    secondColumn: 'message_created_at',
  },
  {
    from: 'message_engagement',
    column: 'message_id',
    to: 'messages',
    secondColumn: 'created_at',
  },
  // Doručení nese čas události, ne čas svého vzniku. Je to zároveň jeho
  // partiční klíč, viz komentář u tabulky a rozhodnutí R22.
  {
    from: 'webhook_deliveries',
    column: 'event_id',
    to: 'webhook_events',
    secondColumn: 'created_at',
  },
  {
    from: 'inbound_dedup',
    column: 'delivery_id',
    to: 'inbound_deliveries',
    secondColumn: 'delivery_created_at',
  },
  // Účtenka se na zprávu spáruje až po dohledání, takže obě složky jsou
  // nullable společně.
  {
    from: 'provider_event_receipts',
    column: 'message_id',
    to: 'messages',
    secondColumn: 'message_created_at',
    nullable: true,
  },
];

/**
 * Evidované výjimky z pravidla R22 („unikátní index partitionované tabulky
 * nesmí stát na sloupci s DEFAULT now()").
 *
 * Každá položka musí říct, co ochranu nese MÍSTO indexu. Bez toho je to
 * jen seznam míst, kde pravidlo neplatí.
 */
export const UNIQUE_INDEX_EXCEPTIONS: ReadonlyArray<{ index: string; reason: string }> = [
  {
    index: 'uq_messages__campaign_contact',
    reason:
      'created_at není volné now(): invariant I1 ho váže cizím klíčem ' +
      'fk_messages__campaign_audience na campaigns.audience_built_at.',
  },
  {
    index: 'uq_provider_event_receipts__dedup',
    reason:
      'skutečnou deduplikaci dělá explicitní WHERE NOT EXISTS nad prefixem ' +
      '(workspace_id, dedup_key); index je jen pojistka proti dvěma workerům ' +
      've stejné mikrosekundě.',
  },
  {
    index: 'uq_inbound_deliveries__dedup',
    reason:
      'skutečnou deduplikaci nese nepartitionovaná tabulka inbound_dedup ' +
      's primárním klíčem (workspace_id, endpoint_id, external_id).',
  },
];

/** Úložné parametry na partition. Na partitionované tabulce jako celku je
 *  nastavit nejde, propisují se jen na nově zakládané partition. */
export type StorageOptions = {
  fillfactor?: number;
  autovacuumVacuumScaleFactor?: number;
  autovacuumVacuumThreshold?: number;
  autovacuumAnalyzeScaleFactor?: number;
  autovacuumVacuumCostDelay?: number;
};

/**
 * messages se za život řádku nejméně třikrát přepíše (claim, marker, výsledek).
 * HOT update se NEUPLATNÍ, protože se pokaždé mění indexovaný sloupec, včetně
 * sloupce v predikátu částečného indexu. Nižší fillfactor přesto pomáhá,
 * ale z jiného důvodu: nová verze řádku se vejde do téže stránky, takže se
 * nenafukuje počet stránek a sekvenční čtení reportu zůstane rychlé.
 * Bez agresivnějšího autovacuum degraduje claim v průběhu kampaně: mrtvé verze
 * zůstávají v částečném indexu idx_messages__claimable a claim je přeskakuje.
 */
export const MESSAGES_STORAGE: StorageOptions = {
  fillfactor: 70,
  autovacuumVacuumScaleFactor: 0.02,
  autovacuumVacuumThreshold: 1000,
  autovacuumAnalyzeScaleFactor: 0.02,
  autovacuumVacuumCostDelay: 0,
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
function assertIdent(value: string, what: string): string {
  if (!IDENT.test(value)) throw new Error(`nepovolený identifikátor ${what}: ${value}`);
  return value;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}
/** Hranice oddílu jako výslovný okamžik v UTC, nikdy jen datum. */
function isoBoundary(date: Date): string {
  return `${date.toISOString().slice(0, 10)} 00:00:00+00`;
}

export function partitionName(table: string, month: Date): string {
  const start = monthStart(month);
  const yyyy = String(start.getUTCFullYear());
  const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
  return `${table}_y${yyyy}m${mm}`;
}

function storageClause(options: StorageOptions): string {
  const parts: string[] = [];
  if (options.fillfactor !== undefined) parts.push(`fillfactor = ${options.fillfactor}`);
  if (options.autovacuumVacuumScaleFactor !== undefined)
    parts.push(`autovacuum_vacuum_scale_factor = ${options.autovacuumVacuumScaleFactor}`);
  if (options.autovacuumVacuumThreshold !== undefined)
    parts.push(`autovacuum_vacuum_threshold = ${options.autovacuumVacuumThreshold}`);
  if (options.autovacuumAnalyzeScaleFactor !== undefined)
    parts.push(`autovacuum_analyze_scale_factor = ${options.autovacuumAnalyzeScaleFactor}`);
  if (options.autovacuumVacuumCostDelay !== undefined)
    parts.push(`autovacuum_vacuum_cost_delay = ${options.autovacuumVacuumCostDelay}`);
  return parts.join(', ');
}

/**
 * ODDÍL NEDOSTÁVÁ ŽÁDNÝ GRANT. Rozhodnutí R20.
 *
 * Dřívější verze plánu tu měla funkci copyGrantsFromParent, která kopírovala
 * práva z rodiče. Byla to díra vedle celé vrstvy RLS: `CREATE TABLE ...
 * PARTITION OF` nedědí relrowsecurity ani politiky, takže oddíl s granty se dal
 * adresovat přímo a vrátil řádky VŠECH projektů. U audit_log šlo přímým
 * DELETE z oddílu smazat i cizí a globální záznamy.
 *
 * Ověřeno spuštěním na PostgreSQL 18: bez grantu na oddílu skončí přímý dotaz
 * `permission denied for table <oddíl>`, zatímco dotaz přes rodiče projde
 * a politika rodiče na něm platí. Práva se kontrolují na relaci, na kterou
 * dotaz míří, takže kopie grantů není k ničemu potřeba.
 *
 * Aplikace ani sender žádný oddíl jménem nečtou a číst nesmí. Hlídá to
 * katalogový test nad pg_class.relacl, ne komentář.
 */

/**
 * Zajistí existenci měsíčních partition. Idempotentní: partition, která už
 * existuje, se přeskočí. Výchozí partition se NEZAKLÁDÁ NIKDY: zápis mimo
 * existující okno má selhat hlasitě, ne skončit v koši, ze kterého se pak
 * nedá odpojit rozsah.
 */
export async function createMonthlyPartitions(
  client: Queryable,
  table: string,
  column: string,
  from: Date,
  months: number,
  storageOptions?: StorageOptions,
): Promise<string[]> {
  assertIdent(table, 'tabulka');
  assertIdent(column, 'sloupec');
  const created: string[] = [];
  const first = monthStart(from);

  for (let offset = 0; offset < months; offset += 1) {
    const start = addMonths(first, offset);
    const end = addMonths(first, offset + 1);
    const name = partitionName(table, start);

    const exists = await client.query<{ present: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [`public.${name}`],
    );
    if (exists.rows[0]!.present) continue;

    const storage = storageOptions ? storageClause(storageOptions) : '';
    // TIMESTAMPTZ s výslovným +00 je POVINNÉ. Holé 'YYYY-MM-DD' se přetypuje
    // podle TimeZone spojení, takže oddíl založený pod Europe/Prague začíná
    // v 22:00 předchozího dne. Ověřeno spuštěním: mezi ním a dalším měsícem
    // založeným pod UTC zůstane DVOUHODINOVÁ DÍRA a zápis do ní tvrdě selže,
    // protože výchozí oddíl se nezakládá. Opačné pořadí dá překryv a oddíl
    // nejde založit vůbec.
    await client.query(
      `CREATE TABLE ${name} PARTITION OF ${table}
         FOR VALUES FROM (TIMESTAMPTZ '${isoBoundary(start)}')
                      TO (TIMESTAMPTZ '${isoBoundary(end)}')
         ${storage ? `WITH (${storage})` : ''}`,
    );
    // Žádné granty. Viz rozhodnutí R20.
    created.push(name);
  }
  return created;
}

/**
 * Doplní chybějící oddíly pro LIBOVOLNÝ rozsah, včetně minulosti.
 * `to` je výlučné. Potřebuje to dávkový import historie (část 5, bod 12.5.3):
 * bez něj by import událostí starších než aktuální měsíc tvrdě selhal,
 * protože výchozí oddíl se nezakládá.
 *
 * Volá se pod mlain_migrator, viz rozhodnutí R30. Aplikační role CREATE
 * na schématu nemá a mít nesmí.
 */
export async function ensurePartitionsForRange(
  client: Queryable,
  table: string,
  column: string,
  from: Date,
  to: Date,
  storageOptions?: StorageOptions,
): Promise<string[]> {
  const first = monthStart(from);
  const last = monthStart(to);
  let months = 0;
  for (let cursor = first; cursor < last; cursor = addMonths(cursor, 1)) months += 1;
  if (months <= 0) return [];
  return createMonthlyPartitions(client, table, column, first, months, storageOptions);
}

/**
 * Volá se z migračního runneru a z příkazu `mlain partitions`.
 *
 * Job `platform.maintain_partitions` to dřív dělat MĚL a nikdy nedělal:
 * zakládání oddílu je DDL a worker běží pod rolí, která schéma nevlastní.
 * Fronta je proto z registru pryč.
 */
export async function ensureUpcomingPartitions(
  client: Queryable,
  from: Date,
  months: number,
): Promise<void> {
  for (const { table, column } of PARTITIONED_TABLES) {
    await createMonthlyPartitions(
      client,
      table,
      column,
      from,
      months,
      table === 'messages' ? MESSAGES_STORAGE : undefined,
    );
  }
}

/**
 * Predikát vlastníka tabulky. Vrací true, když se rozsah SMÍ odpojit.
 * Bez něj funkce neudělá nic: jen vlastník ví, kdy jsou data zbytná.
 *
 * Když rozsah odpojit nesmí, vrátí důvod místo `false`. Prosté `false` stačilo,
 * dokud výsledek nikdo nečetl; provozovatel, který se ptá „proč mi retence
 * nesmazala nic", potřebuje větu, ne prázdný seznam.
 */
export type VetoResult = true | { keep: string };

export type PartitionVeto = (
  client: Queryable,
  from: Date,
  to: Date,
  partition: string,
) => Promise<VetoResult>;

/** Rozhodnutí o jednom oddílu, ať už se provede, nebo jen vypíše. */
export type PartitionDecision = {
  partition: string;
  /** Doslovný `pg_get_expr(relpartbound)`, tedy to, co o oddílu tvrdí katalog. */
  bound: string;
  /** Horní hranice oddílu. `null` znamená, že se ji nepodařilo přečíst. */
  upperBound: Date | null;
  drop: boolean;
  /** Proč se oddíl nechává. U `drop: true` je `undefined`. */
  keepReason?: string;
};

const RANGE_BOUND = /^FOR VALUES FROM \('([^']+)'\) TO \('([^']+)'\)$/;

/**
 * Hranice oddílu se čtou z KATALOGU, ne ze jména.
 *
 * Dřívější verze si `from` a `to` skládala regexem ze jména oddílu
 * (`_y2026m08`). To je předpoklad, ne fakt: jméno je jen řetězec, který někdo
 * zvolil, a `CREATE TABLE ... PARTITION OF` nikde nevynucuje, že se hranice
 * a jméno shodují. Oddíl založený ručně při obnově nebo při importu historie
 * mohl mít jméno srpnové a hranice roční, a kód by ho zahodil celý, protože by
 * se ptal jména. Tohle je jediné místo v úklidu, kde se rozhoduje o smazání
 * dat, takže se ptá katalogu.
 *
 * Vrací `null` u všeho, co není jednoduchý rozsah s jednou hodnotou na obou
 * stranách: výchozí oddíl (`DEFAULT`), `MINVALUE`/`MAXVALUE`, hash i list
 * partitioning a vícesloupcový klíč. Volající to bere jako „hranice není jistá,
 * oddíl nech" (požadavek zadání), ne jako „hranice je nula".
 */
export function parseBounds(bound: string): { from: Date; to: Date } | null {
  const match = bound.trim().match(RANGE_BOUND);
  if (!match) return null;
  const from = parseTimestamp(match[1]!);
  const to = parseTimestamp(match[2]!);
  if (from === null || to === null) return null;
  return { from, to };
}

/**
 * Časové razítko tak, jak ho tiskne Postgres, na `Date`.
 *
 * Obojí níž je NUTNÉ a obojí se pozná až na skutečné databázi:
 *
 *  - mezera místo `T`. Postgres tiskne `2026-08-01 00:00:00+00`, ISO 8601 chce
 *    `T`.
 *  - offset `+00` BEZ MINUT. ISO 8601 zná `Z`, `+00:00` a `+0000`, ale
 *    dvouciferný `+00` ne, takže `new Date('2026-08-01T00:00:00+00')` vrátí
 *    Invalid Date. Ověřeno spuštěním proti běžící databázi: bez tohohle kroku
 *    se nepřečetla hranice ANI JEDNOHO oddílu a úklid tvrdil, že „hranice se
 *    nedá přečíst z katalogu" úplně u všech. Padlo to na bezpečnou stranu,
 *    tedy nesmazalo nic, ale retence by tím byla dál mrtvá.
 */
function parseTimestamp(text: string): Date | null {
  const normalized = text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Odpojí a zahodí partition starší než `before`. `veto` je POVINNÉ.
 *
 * U messages je to past, ne formalita: celá kampaň leží v jedné partition
 * vybrané při materializaci (invariant I1), takže kampaň materializovaná
 * 31. srpna má všechny zprávy v srpnové partition, i když se dorozesílá
 * v září. Dlouho pozastavená kampaň by si jinak přišla o outbox pod rukama
 * a po obnovení by se tvářila jako doběhlá, přestože neodeslala nic.
 */
export async function dropPartitionsBefore(
  client: Queryable,
  table: string,
  column: string,
  before: Date,
  veto: PartitionVeto,
): Promise<string[]> {
  assertIdent(table, 'tabulka');
  assertIdent(column, 'sloupec');

  const decisions = await planPartitionsBefore(client, table, before, veto);
  return applyPartitionPlan(client, table, decisions);
}

/**
 * Provede hotový plán. Oddělené od `planPartitionsBefore` proto, aby si
 * volající mohl plán nechat vypsat a TÝŽ plán pak provést. Kdyby si provedení
 * počítalo rozhodnutí znovu, mohlo by mezi výpisem a zásahem zahodit něco
 * jiného, než co uživatel viděl.
 */
export async function applyPartitionPlan(
  client: Queryable,
  table: string,
  decisions: readonly PartitionDecision[],
): Promise<string[]> {
  assertIdent(table, 'tabulka');

  const dropped: string[] = [];
  for (const decision of decisions) {
    if (!decision.drop) continue;
    const partition = assertIdent(decision.partition, 'partition');

    // CONCURRENTLY je povinné: prosté DETACH bere ACCESS EXCLUSIVE zámek
    // na CELOU partitionovanou tabulku, takže u velké instalace zastaví claim
    // i příjem událostí na dobu odpojení. Ověřeno spuštěním na PostgreSQL 18.
    //
    // Cena je, že příkaz NESMÍ běžet uvnitř transakčního bloku. Volající proto
    // předává spojení mimo transakci; retenční příkaz CLI to tak dělá.
    //
    // Když se předchozí pokus přerušil, zůstane oddíl ve stavu "detach pending"
    // a další DETACH skončí chybou. FINALIZE ten stav dokončí a je bezpečné
    // ho volat i tehdy, když nic nevisí.
    try {
      await client.query(`ALTER TABLE ${table} DETACH PARTITION ${partition} CONCURRENTLY`);
    } catch (error) {
      if ((error as { code?: string }).code !== '55006') throw error;
      await client.query(`ALTER TABLE ${table} DETACH PARTITION ${partition} FINALIZE`);
    }
    // IF EXISTS je tu proto, že mezi DETACH a DROP už oddíl NENÍ součástí
    // tabulky. Když běh spadne mezi těmito dvěma příkazy, zůstane osiřelá
    // tabulka a další běh ji zahodí; kdyby ji mezitím smazal někdo ručně,
    // nesmí to celý úklid položit.
    await client.query(`DROP TABLE IF EXISTS ${partition}`);
    dropped.push(partition);
  }
  return dropped;
}

/**
 * Spočítá, co by se odpojilo, a NIC nezmění. Používá to režim nanečisto
 * i samotné odpojování, aby se rozhodnutí nepočítalo dvakrát dvěma způsoby.
 *
 * Predikáty veto se pouštějí i tady. Jsou to čtecí dotazy a bez nich by režim
 * nanečisto tvrdil, že smaže oddíl, který ostrý běh nechá.
 */
export async function planPartitionsBefore(
  client: Queryable,
  table: string,
  before: Date,
  veto: PartitionVeto,
): Promise<PartitionDecision[]> {
  assertIdent(table, 'tabulka');
  if (typeof veto !== 'function') {
    throw new Error(
      `planPartitionsBefore(${table}): chybí veto predikát, bez něj se neodpojuje nic`,
    );
  }

  const { rows } = await client.query<{ relname: string; bound: string }>(
    `SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
      WHERE i.inhparent = $1::regclass
      ORDER BY c.relname`,
    [table],
  );

  const decisions: PartitionDecision[] = [];
  for (const row of rows) {
    const bounds = parseBounds(row.bound);
    if (bounds === null) {
      decisions.push({
        partition: row.relname,
        bound: row.bound,
        upperBound: null,
        drop: false,
        keepReason: 'hranice oddílu se nedá přečíst z katalogu, oddíl se nechává',
      });
      continue;
    }
    // Neostrá nerovnost je záměr. Horní hranice oddílu je VÝLUČNÁ, takže
    // nejmladší možný řádek v oddílu je o mikrosekundu starší než ona.
    // Oddíl, jehož horní hranice padne přesně na lhůtu, tedy lhůtu splňuje
    // a žádný řádek mladší než lhůta v něm ležet nemůže.
    if (bounds.to > before) {
      decisions.push({
        partition: row.relname,
        bound: row.bound,
        upperBound: bounds.to,
        drop: false,
        keepReason: 'oddíl zasahuje do retenční lhůty',
      });
      continue;
    }

    const verdict = await veto(client, bounds.from, bounds.to, row.relname);
    decisions.push(
      verdict === true
        ? { partition: row.relname, bound: row.bound, upperBound: bounds.to, drop: true }
        : {
            partition: row.relname,
            bound: row.bound,
            upperBound: bounds.to,
            drop: false,
            keepReason: verdict.keep,
          },
    );
  }
  return decisions;
}

/**
 * Třífázové založení indexu na partitionované tabulce, která už nese data.
 *
 * Prosté `CREATE INDEX` na rodiči vezme ACCESS EXCLUSIVE zámek na tabulku
 * i všechny oddíly a drží ho po celou dobu stavby. Nad velkou tabulkou to
 * znamená, že první upgradová migrace narazí na lock_timeout a instalace
 * skončí v režimu údržby. `CREATE INDEX CONCURRENTLY` zase na partitionované
 * tabulce jako celku nefunguje.
 *
 * Jediný povolený postup je tenhle a ověřeno spuštěním dává platný index:
 *   1. `CREATE INDEX ... ON ONLY <rodič>` (vznikne neplatný, prázdný index)
 *   2. `CREATE INDEX CONCURRENTLY` na každém oddílu zvlášť
 *   3. `ALTER INDEX ... ATTACH PARTITION ...` pro každý z nich; po připojení
 *      posledního se index rodiče sám stane platným
 *
 * Migrace, která tuhle funkci volá, MUSÍ mít direktivu `-- mlain:no-transaction`.
 */
export async function createIndexConcurrentlyOnPartitioned(
  client: Queryable,
  options: { parent: string; indexName: string; definition: string },
): Promise<void> {
  const parent = assertIdent(options.parent, 'tabulka');
  const parentIndex = assertIdent(options.indexName, 'index');

  await client.query(
    `CREATE INDEX IF NOT EXISTS ${parentIndex} ON ONLY ${parent} ${options.definition}`,
  );

  const { rows } = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
      WHERE i.inhparent = $1::regclass ORDER BY c.relname`,
    [parent],
  );

  for (const row of rows) {
    const childIndex = assertIdent(`${row.relname}__${parentIndex}`.slice(0, 63), 'index');
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${childIndex} ` +
        `ON ${assertIdent(row.relname, 'partition')} ${options.definition}`,
    );
    await client.query(`ALTER INDEX ${parentIndex} ATTACH PARTITION ${childIndex}`);
  }
}
