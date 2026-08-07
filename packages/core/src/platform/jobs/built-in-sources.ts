import { sql } from 'drizzle-orm';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { ApiError } from '../../errors/api-error';
import { cancelImport } from '../../contacts/import/service';
import { cancelCampaign } from '../../campaigns/control/cancel';
import {
  registerJobSource,
  registeredJobKinds,
  type JobCancelOutcome,
  type JobListOptions,
  type JobRecord,
  type JobSource,
  type JobStatus,
} from './registry';

/**
 * ZDROJE ÚLOH PRO CENTRUM ÚLOH.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Registr zdrojů (`registry.ts`) existoval i s API,
 * s oprávněními a s odznakem v topbaru, jen `registerJobSource` NIKDO NIKDY
 * NEZAVOLAL: v produkčním kódu bylo nula volání a jediné výskyty byly v testech.
 * Endpoint `/api/v1/jobs` tedy vracel prázdné pole a `running_count: 0`, a to
 * i uprostřed běžícího importu půlmilionového souboru. Tichá nula: uživatel
 * nevidí postup a má za to, že se úloha nespustila.
 *
 * KTERÉ ÚLOHY SEM PATŘÍ A KTERÉ NE. Do Centra úloh patří práce, která TRVÁ
 * a kterou SPUSTIL ČLOVĚK, protože jedině u takové dává smysl ptát se „kde to
 * je". Ne tedy cronové úklidy (ty nikdo nespouští a nikdo na ně nečeká) ani
 * krátké úlohy typu přepočtu segmentu. Zůstávají dvě:
 *
 *  - IMPORT KONTAKTŮ. Tabulka `imports` nese průběh po řádcích i výsledek.
 *  - STAVBA PUBLIKA KAMPANĚ. Tabulka `campaign_audience_progress` nese fázi
 *    a počet vložených řádků; celkový počet drží `campaigns.audience_size`.
 *
 * Až přibude třetí (export kontaktů, hromadné operace), přidá se sem vedle nich.
 * Registr je otevřený schválně, aby doména nemusela znát API.
 */

/** Kolik úloh se z jednoho zdroje načte nejvýš. Slití a ořez řeší `listJobs`. */
const MAX_PER_SOURCE = 100;

/**
 * Podmínka kurzoru do `WHERE`. Bez kurzoru je to `TRUE`, ne vynechaný kus SQL:
 * skládat dotaz ze dvou různých řetězců podle toho, jestli přišel parametr,
 * znamená dvě cesty, z nichž se testuje jedna.
 *
 * POROVNÁVÁ SE OSTŘE (`<`), takže úloha přesně na hranici se na další stránce
 * neopakuje. Cenou je, že dvě úlohy se SHODNOU časovou značkou na milisekundu
 * můžou stránku rozdělit; obě tabulky ale píšou `updated_at` z `now()` uvnitř
 * vlastní transakce, takže shoda na mikrosekundu napříč dvěma zdroji je
 * teoretická, a duplicitní řádek by byl horší než chybějící.
 */
function beforeCondition(column: string, before: string | undefined) {
  if (before === undefined) return sql`TRUE`;
  return sql`${sql.raw(column)} < ${before}::timestamptz`;
}

type ImportRow = {
  id: string;
  filename: string;
  status: string;
  processed_rows: string | number;
  total_rows: string | number | null;
  error_rows: string | number;
  failure_code: string | null;
  started_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
  cancellable: boolean;
  stopping: boolean;
};

/**
 * Jak dlouho po posledním zápisu se ještě věří, že běh žije.
 *
 * ODKUD TO ČÍSLO JE. Ani jedna z obou úloh nemá heartbeat; jediný doklad
 * o životě je, že přibyla dávka, tedy že se pohnulo `updated_at`. Import píše
 * dávku po tisíci řádcích, stavba publika po pěti tisících, takže dvě minuty
 * ticha znamenají, že běh skončil nebo je mrtvý.
 *
 * Chyba je schválně na stranu opatrnosti: kratší lhůta by u pomalé dávky
 * tvrdila „zastaveno" o někom, kdo ještě zapisuje. Delší jen o kus prodlouží
 * větu „zastavuje se", což nikoho nesvede na scestí.
 */
const STOPPING_WINDOW = sql`interval '2 minutes'`;

/**
 * Sloupce, které Centru úloh říkají, jestli u importu smí nabídnout zastavení
 * a jestli se zastavení právě děje. Jsou v obou dotazech, proto zvlášť.
 *
 * `cancellable` kopíruje podmínku `cancelImport()`: `previewing` a `importing`,
 * nic jiného. Stavový automat importu z `pending` ani `validating` přechod do
 * `cancelled` nezná, takže tlačítko tam nesmí být ani na okamžik.
 *
 * `stopping` chce navíc `processed_rows > 0`. Bez toho by zrušený náhled, kde
 * NIKDY NIC neběželo, dvě minuty tvrdil, že se zastavuje.
 */
const IMPORT_FLAGS = sql`
  (i.status IN ('previewing','importing')) AS cancellable,
  (i.status = 'cancelled' AND i.processed_rows > 0
     AND i.updated_at > now() - ${STOPPING_WINDOW}) AS stopping`;

/**
 * Stav importu na stav úlohy.
 *
 * DĚLICÍ ČÁRA JE „KDO SE NA TO KOUKÁ", ne „jak daleko je průvodce". `running`
 * znamená, že na importu PRÁVĚ TEĎ někdo pracuje, tedy úloha ve frontě
 * (`importing`) nebo detekce uvnitř požadavku (`validating`). `paused` znamená,
 * že se čeká na ČLOVĚKA a samo se nic nestane.
 *
 * `previewing` JE `paused`, NE `running`, a je to rozhodnutí, ne překlep.
 * V té fázi nic neběží: soubor je načtený, náhled hotový a čeká se, až člověk
 * potvrdí mapování sloupců. Kdyby se to hlásilo jako `running`, ukazoval by
 * odznak v topbaru běžící úlohu, která sama nikdy neskončí, a odznak, který
 * nejde vynulovat, si člověk odvykne číst.
 *
 * `pending` se ze stejného důvodu přesunul z `running` k `paused`, a je to
 * oprava téhož nálezu o krok dřív. Nahrání souboru import NESPOUŠTÍ: do fronty
 * se nezařazuje nic, dokud člověk neklikne na „Naimportovat"
 * (`contacts/import/service.ts`). Nedokončený průvodce tedy rozsvěcel odznak
 * „Běží 1 úloha" navždy, přestože se ani nemělo co pohnout.
 */
function importStatus(status: string): JobStatus {
  switch (status) {
    case 'validating':
    case 'importing':
      return 'running';
    case 'pending':
    case 'previewing':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'completed_with_errors':
      return 'completedWithErrors';
    case 'cancelled':
      return 'cancelled';
    default:
      // `failed` i cokoli neznámého. Neznámý stav je radši selhání než tiché
      // vypuštění ze seznamu: úloha, kterou Centrum nezobrazí, neexistuje.
      return 'failed';
  }
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function importRecord(row: ImportRow): JobRecord {
  return {
    id: row.id,
    kind: 'import',
    title: row.filename,
    status: importStatus(row.status),
    done: toNumber(row.processed_rows),
    // `total_rows` je NULL, dokud se soubor nespočítá. Nula je tu poctivější
    // než odhad: obrazovka pozná „ještě nevím" podle toho, že celek je nula.
    total: toNumber(row.total_rows),
    startedBy: row.started_by,
    startedAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
    finishedAt: toIso(row.finished_at),
    // Kód selhání, ne jeho detail: `failure_detail` může nést kus nahraného
    // souboru, tedy e-mail nebo jméno, a Centrum úloh vidí i role bez práva
    // na obsah kontaktů.
    note: row.failure_code,
    cancellable: row.cancellable === true,
    stopping: row.stopping === true,
  };
}

/**
 * Zastavení importu.
 *
 * NEZABÍJÍ BĚH, jen přepne stav. Běh se na `imports.status` ptá u každého řádku
 * (`contacts/import/run-context.ts`), takže se sám ukončí u nejbližší kontroly
 * a rozepsanou dávku ještě dopíše. Proto `cancelling`, ne `cancelled`.
 *
 * Když podmíněný UPDATE nezabere, doména hlásí `conflict`. Pro Centrum úloh to
 * chyba NENÍ: znamená to, že úloha mezitím doběhla, nebo že tohle je druhé
 * kliknutí. Konečný stav se v obou případech nepřepisuje.
 */
async function runImportCancel(ctx: WorkspaceContext, id: string): Promise<JobCancelOutcome> {
  try {
    await cancelImport(ctx, id);
    return 'cancelling';
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'conflict') throw err;
    const after = await importSource.get(ctx, id);
    return after?.status === 'cancelled' ? 'already_cancelled' : 'already_finished';
  }
}

/**
 * Jméno toho, kdo úlohu spustil, se čte LEFT JOINem na `users`.
 *
 * `imports.created_by` je `ON DELETE SET NULL`, takže po smazání účtu zbude
 * NULL a Centrum úlohu ukáže jako systémovou. To je správný konec: pravidlo 5.7
 * chce u cizí úlohy jméno, ne odkaz na účet, který už neexistuje.
 */
const importSource: JobSource = {
  kind: 'import',
  async list(ctx: WorkspaceContext, opts: JobListOptions): Promise<JobRecord[]> {
    const limit = Math.min(opts.limit, MAX_PER_SOURCE);
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<ImportRow>(sql`
        SELECT i.id, i.filename, i.status, i.processed_rows, i.total_rows, i.error_rows,
               i.failure_code, i.created_at, i.updated_at, i.finished_at,
               NULLIF(u.name, '') AS started_by, ${IMPORT_FLAGS}
          FROM imports AS i
          LEFT JOIN users AS u ON u.id = i.created_by
         WHERE i.workspace_id = ${ctx.workspaceId}::uuid
           AND ${beforeCondition('i.updated_at', opts.before)}
         ORDER BY i.updated_at DESC
         LIMIT ${limit}`),
    );
    return rows.map(importRecord);
  },
  async get(ctx: WorkspaceContext, id: string): Promise<JobRecord | null> {
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<ImportRow>(sql`
        SELECT i.id, i.filename, i.status, i.processed_rows, i.total_rows, i.error_rows,
               i.failure_code, i.created_at, i.updated_at, i.finished_at,
               NULLIF(u.name, '') AS started_by, ${IMPORT_FLAGS}
          FROM imports AS i
          LEFT JOIN users AS u ON u.id = i.created_by
         WHERE i.workspace_id = ${ctx.workspaceId}::uuid AND i.id = ${id}::uuid`),
    );
    const row = rows[0];
    return row ? importRecord(row) : null;
  },
  async count(ctx: WorkspaceContext): Promise<number> {
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<{ total: string | number }>(sql`
        SELECT count(*) AS total FROM imports
         WHERE workspace_id = ${ctx.workspaceId}::uuid`),
    );
    return toNumber(rows[0]?.total);
  },
  // `contacts:import`, ne `timeline:read`, kterým se Centrum úloh čte. Kdo smí
  // vidět, že import běží, nemusí smět zahodit jeho druhou polovinu.
  cancel: { permission: 'contacts:import', run: runImportCancel },
};

type AudienceRow = {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  phase: string;
  inserted_rows: number | string;
  audience_size: number | string | null;
  started_by: string | null;
  started_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
  cancellable: boolean;
  stopping: boolean;
};

/**
 * Stav stavby publika se čte z FÁZE I ZE STAVU KAMPANĚ, ne jen z fáze.
 *
 * Původní podoba brala jen `phase`, a měla tichou vadu: zrušená kampaň fázi
 * nikdy nepřepne na `done` (materializační smyčka se při `cancelled` prostě
 * vrátí, viz `campaigns/jobs/materialize.ts`), takže úloha zůstala v Centru
 * navždy jako „běží", a to i v odznaku v hlavičce. Odznak, který nejde
 * vynulovat, si člověk odvykne číst.
 *
 * `default` je `failed` ze stejného důvodu jako u importu: fáze bez konce
 * u kampaně, která se nestaví ani nečeká, je porucha, ne běh.
 */
function audienceStatus(row: Pick<AudienceRow, 'phase' | 'campaign_status'>): JobStatus {
  if (row.phase === 'done') return 'completed';
  switch (row.campaign_status) {
    case 'queueing':
    case 'sending':
      return 'running';
    case 'paused':
      return 'paused';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failed';
  }
}

/**
 * Zastavení stavby publika = ZRUŠENÍ CELÉ KAMPANĚ.
 *
 * Není to volba návrhu, je to fakt domény: publikum se staví jen v `queueing`
 * a jediný stav, do kterého se odtamtud dá odejít, aniž se pošta rozjede, je
 * `cancelled` (`campaigns/state-machine.ts`). Materializační smyčka se na stav
 * kampaně ptá po každé dávce a po zrušení navíc uklidí, co stihla vložit.
 *
 * Uživatel to musí vědět PŘED potvrzením, ne až z výsledku, proto to říká
 * potvrzovací okno v Centru úloh.
 */
async function runAudienceCancel(ctx: WorkspaceContext, id: string): Promise<JobCancelOutcome> {
  const result = await cancelCampaign(ctx, id, { reason: 'user' });
  if (result.cancelled) return 'cancelling';
  // Podmíněný UPDATE nezabral: kampaň je v koncovém stavu, nebo ji mezitím
  // zrušil někdo jiný. Ani jedno není chyba obsluhy.
  const after = await campaignAudienceSource.get(ctx, id);
  return after?.status === 'cancelled' ? 'already_cancelled' : 'already_finished';
}

/**
 * `cancellable` schválně NEBERE `sending`. Jakmile je publikum hotové a pošta
 * jde ven, není to už úloha na pozadí, ale rozesílka: ta se zastavuje na
 * obrazovce kampaně, kde je vidět, kolika lidem už zpráva došla.
 */
const AUDIENCE_FLAGS = sql`
  (p.phase <> 'done' AND c.status IN ('queueing','paused')) AS cancellable,
  (c.status = 'cancelled' AND p.phase <> 'done'
     AND p.updated_at > now() - ${STOPPING_WINDOW}) AS stopping`;

function audienceRecord(row: AudienceRow): JobRecord {
  return {
    id: row.campaign_id,
    kind: 'campaign_audience',
    title: row.campaign_name,
    status: audienceStatus(row),
    done: toNumber(row.inserted_rows),
    // Celek drží kampaň, ne tabulka postupu: `audience_size` se spočítá při
    // sestavení publika. Než se spočítá, je NULL a z celku vyjde nula.
    total: toNumber(row.audience_size),
    startedBy: row.started_by,
    startedAt: toIso(row.started_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
    finishedAt: toIso(row.finished_at),
    note: null,
    cancellable: row.cancellable === true,
    stopping: row.stopping === true,
  };
}

const campaignAudienceSource: JobSource = {
  kind: 'campaign_audience',
  async list(ctx: WorkspaceContext, opts: JobListOptions): Promise<JobRecord[]> {
    const limit = Math.min(opts.limit, MAX_PER_SOURCE);
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<AudienceRow>(sql`
        SELECT p.campaign_id, c.name AS campaign_name, c.status AS campaign_status, p.phase,
               p.inserted_rows, c.audience_size, p.started_at, p.updated_at, p.finished_at,
               NULLIF(u.name, '') AS started_by, ${AUDIENCE_FLAGS}
          FROM campaign_audience_progress AS p
          JOIN campaigns AS c ON c.id = p.campaign_id
          LEFT JOIN users AS u ON u.id = c.created_by
         WHERE p.workspace_id = ${ctx.workspaceId}::uuid
           AND ${beforeCondition('p.updated_at', opts.before)}
         ORDER BY p.updated_at DESC
         LIMIT ${limit}`),
    );
    return rows.map(audienceRecord);
  },
  async get(ctx: WorkspaceContext, id: string): Promise<JobRecord | null> {
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<AudienceRow>(sql`
        SELECT p.campaign_id, c.name AS campaign_name, c.status AS campaign_status, p.phase,
               p.inserted_rows, c.audience_size, p.started_at, p.updated_at, p.finished_at,
               NULLIF(u.name, '') AS started_by, ${AUDIENCE_FLAGS}
          FROM campaign_audience_progress AS p
          JOIN campaigns AS c ON c.id = p.campaign_id
          LEFT JOIN users AS u ON u.id = c.created_by
         WHERE p.workspace_id = ${ctx.workspaceId}::uuid AND p.campaign_id = ${id}::uuid`),
    );
    const row = rows[0];
    return row ? audienceRecord(row) : null;
  },
  async count(ctx: WorkspaceContext): Promise<number> {
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<{ total: string | number }>(sql`
        SELECT count(*) AS total FROM campaign_audience_progress
         WHERE workspace_id = ${ctx.workspaceId}::uuid`),
    );
    return toNumber(rows[0]?.total);
  },
  // `campaigns:control`, tedy totéž oprávnění, jakým se kampaň ruší na své
  // vlastní obrazovce. Centrum úloh nesmí být zadní vrátka do domény.
  cancel: { permission: 'campaigns:control', run: runAudienceCancel },
};

/**
 * Zapojení vestavěných zdrojů. Idempotentní, aby se dalo volat odkudkoli.
 *
 * VOLÁ SE ZE `registerJobRoutes`, ne z `instrumentation.ts`, a je to poučení
 * z jedné celodenní tiché vady. Next.js vyhodnocuje `instrumentation.ts`
 * v JINÉM MODULOVÉM GRAFU než obsluhu trasy, takže zápis do modulové proměnné
 * odtamtud obsluha nevidí: čte vlastní kopii modulu, kde je registr prázdný.
 * Jednotkové testy to nechytí, protože v testu je graf jeden. Registrace
 * z místa, kde se registrují samotné cesty, tenhle problém nemá z principu:
 * obsluha i registrace jsou tentýž modul.
 */
export function installJobSources(): void {
  const registered = new Set(registeredJobKinds());
  for (const source of [importSource, campaignAudienceSource]) {
    if (registered.has(source.kind)) continue;
    registerJobSource(source);
  }
}
