import { sql, type SQL } from 'drizzle-orm';
import { queue } from './registry';

/**
 * JEDINÝ SPRÁVNÝ TVAR TRANSAKČNÍHO ZAŘAZENÍ ÚLOHY.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Produkt `boss.send()` nepoužívá ani jednou: úloha
 * se musí zařadit ve STEJNÉ transakci jako doménová změna, jinak přežije její
 * rollback. Každá doména si proto napsala vlastní INSERT do tabulky pg-bossu
 * a všech sedm kopií mělo tentýž seznam sloupců:
 *
 *   (name, data, singleton_key, retry_limit, retry_backoff, expire_seconds, start_after)
 *
 * V tom seznamu CHYBÍ `policy`, a to je vada, kvůli které slučování duplicitních
 * úloh v produktu nefungovalo ani po zapnutí politik na frontách.
 *
 * Slučování totiž nedělá sloupec `pgboss.queue.policy`. Dělají ho částečné
 * unikátní indexy nad tabulkou úloh a ty se řídí sloupcem `policy` NA ŘÁDKU
 * ÚLOHY:
 *
 *   CREATE UNIQUE INDEX job_i6 ON pgboss.job (name, COALESCE(singleton_key, ''))
 *     WHERE state <= 'active' AND policy = 'exclusive'
 *
 * Vlastní `insertJobs` pg-bossu politiku do řádku kopíruje z fronty. Našich
 * sedm insertů ji nechávalo na NULL, a NULL se nikdy nerovná `'exclusive'`,
 * takže se index na řádek nevztahoval a nesloučilo se nic. Klíč se přitom
 * poctivě posílal, jen padal do sloupce, který byl z pohledu indexu neviditelný.
 *
 * DRUHÁ POLOVINA OPRAVY JE `ON CONFLICT DO NOTHING`. Jakmile se `policy` doplní,
 * začne druhá úloha s týmž klíčem narážet na unikátní index. `boss.send()` má
 * `ON CONFLICT DO NOTHING` a vrátí `null`; ručně psané inserty ho neměly, takže
 * by skončily na `23505`. A protože běží ve stejné transakci jako doménová
 * změna, neshodily by jen zařazení, ale CELOU operaci: import by se nepotvrdil,
 * kampaň neuložila, souhlas nezapsal. Sloučená úloha se má tiše nezařadit,
 * ne shodit to, kvůli čemu vznikla.
 *
 * PROČ SE POLITIKA ČTE PODDOTAZEM, NE Z REGISTRU. Kdyby se opsala z `QueueEntry`,
 * vznikly by dvě pravdy: jedna v TypeScriptu a jedna v databázi. Rozešly by se
 * v okamžiku, kdy někdo změní registr a nerestartuje workera, a projevilo by se
 * to zase jen tím, že se přestane slučovat. Poddotaz čte tutéž hodnotu, jakou
 * používá index.
 *
 * PROČ PODDOTAZ, A NE `FROM queue q JOIN`. S `JOIN` by neexistující fronta
 * znamenala nula vložených řádků, tedy TICHÉ zahození úlohy. Se skalárním
 * poddotazem vyjde NULL, řádek se vloží a padne cizí klíč `job.name -> queue.name`
 * přesně tak hlasitě jako dosud. Neexistující fronta je vada nasazení a musí být
 * vidět.
 */
/**
 * Co se má stát, když politika fronty úlohu NEZAŘADÍ.
 *
 * Není to technický přepínač, je to rozhodnutí o ztrátě práce, a proto je
 * povinné. `ON CONFLICT DO NOTHING` samo o sobě není odpověď: brání jen tomu,
 * aby sloučení shodilo doménovou transakci. Jestli je zahození přijatelné, ví
 * jedině volající.
 *
 *  - `drop` je správně tam, kde práci drží DATABÁZE, ne úloha: přepočty, úklidy,
 *    tiky z plánovače. Zahozený požadavek udělá běh, který zrovna probíhá nebo
 *    čeká, protože si data načte, až na něj přijde řada.
 *
 *  - `fail` je správně tam, kde na zařazení čeká ČLOVĚK. Zahození by znamenalo
 *    uloženou kampaň, která nikdy neodejde, nebo potvrzený import, se kterým se
 *    nikdy nic nestane. Volající dostane výjimku a může vrátit stav zpátky.
 *    Používá se tam, kde by tiché zahození vyrobilo obrazovku „připravuje se",
 *    která se nikdy nezmění.
 */
export type OnMerged = 'drop' | 'fail';

export type JobInsert = {
  /** Schéma pg-bossu, tedy `PGBOSS_SCHEMA`. Volající ho čte ze své konfigurace. */
  readonly schema: string;
  readonly name: string;
  readonly payload: Record<string, unknown>;
  /** Klíč slučování. Tvar předepisuje `singletonKeyTemplate` v registru. */
  readonly singletonKey?: string | undefined;
  readonly startAfterSeconds?: number | undefined;
  /**
   * Přebití politiky opakování z registru. Bez nich se berou hodnoty z `QueueEntry`.
   *
   * NENÍ TO KOSMETIKA A NESMÍ SE TO ODSTRANIT. Doména kontaktů má vlastní výčet
   * `CONTACTS_QUEUES` a ten se se sdíleným registrem u ČTYŘ front rozchází
   * v počtu pokusů (expirace se srovnala a `gdpr.erase` taky, viz hlavička
   * `contacts/queues.ts`). Nejostřejší případ je `contacts.bulk_delete`: doména mu
   * dává `retryLimit: 0`, sdílený registr `3`. Kdyby tenhle soubor hodnoty z registru
   * vnutil, začalo by se hromadné mazání kontaktů po selhání opakovat, a to je změna
   * chování, o kterou nikdo nežádal a která by se schovala v úpravě o slučování.
   *
   * Import je používá z jiného důvodu: rozpracovaný běh se po pádu NESMÍ spustit
   * znovu od začátku, jinak by naimportoval už zapsané řádky podruhé.
   */
  readonly retryLimit?: number | undefined;
  readonly retryBackoff?: boolean | undefined;
  readonly expireInSeconds?: number | undefined;
};

/** Nejmenší tvar transakce, který zařazení potřebuje. Každá doména svůj `Tx` splní. */
export interface JobExecutor {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

/**
 * Úloha se kvůli slučování nezařadila a volající řekl, že to je vada.
 *
 * Vlastní třída, ne obyčejný `Error`: volající na ni potřebuje reagovat jinak
 * než na výpadek databáze. Kampaň se po ní vrací ze stavu `queueing` zpátky,
 * kdežto po výpadku spojení se transakce stejně celá vrátí sama.
 */
export class JobNotEnqueuedError extends Error {
  constructor(
    readonly queue: string,
    readonly singletonKey: string | undefined,
  ) {
    super(
      `Úloha ve frontě ${queue} se nezařadila: úloha s klíčem ` +
        `${singletonKey ?? '(bez klíče)'} už čeká nebo běží a politika fronty je slučuje. ` +
        'Volající si vyžádal onMerged: "fail", protože na zařazení čeká uživatel a tiché ' +
        'zahození by nechalo jeho požadavek viset bez odezvy.',
    );
    this.name = 'JobNotEnqueuedError';
  }
}

/**
 * Zkontroluje, že se ke klíčované frontě posílá klíč.
 *
 * POJISTKA ZA BĚHU, ne náhrada testu. Brána
 * `packages/core/test/queues/merge-policy.test.ts` hlídá tutéž vazbu staticky
 * a spadne dřív, než se kód nasadí. Tohle je pro případ, kdy klíč zmizí cestou
 * (nepovinný parametr, prázdný řetězec z `String(undefined)`), což statický sken
 * nevidí. Kontroluje se jen u front, které slučování MAJÍ zapnuté: u ostatních
 * je klíč v registru jen deklarovaný záměr a producent ho legitimně neposílá.
 */
function assertSingletonKey(name: string, singletonKey: string | undefined): void {
  const entry = queue(name);
  if (entry.policy === undefined) return;
  if (singletonKey !== undefined && singletonKey.length > 0) return;
  throw new Error(
    `Fronta ${name} má zapnuté slučování (policy: ${entry.policy}) a klíč ve tvaru ` +
      `${entry.singletonKeyTemplate ?? '?'}, ale zařazuje se bez něj. Bez klíče by úloha ` +
      "spadla do společného kbelíku COALESCE(singleton_key, '') a slučovala by se " +
      's úlohami, se kterými nesouvisí.',
  );
}

/**
 * Sestaví INSERT do tabulky úloh pg-bossu. Volá se uvnitř doménové transakce:
 * `await tx.execute(jobInsert({ ... }))`.
 */
export function jobInsert(input: JobInsert): SQL {
  if (!/^[A-Za-z0-9_]{1,50}$/.test(input.schema)) {
    throw new Error(`Schéma pg-bossu "${input.schema}" není platný identifikátor.`);
  }
  assertSingletonKey(input.name, input.singletonKey);

  const entry = queue(input.name);
  const schema = sql.identifier(input.schema);

  /*
   * `dead_letter` SE ČTE Z FRONTY TÝMŽ PODDOTAZEM JAKO `policy`, a je to oprava
   * vady, kterou tenhle komentář dřív popisoval jako záměr.
   *
   * Stálo tu, že se sloupec nevyplňuje schválně, protože má cizí klíč na
   * `queue.name` a hodnota `<fronta>.dlq` by zápis shodila všude, kde dead
   * letter frontu nikdo nezaložil. To je pravda o KONSTANTĚ opsané z registru,
   * ne o poddotazu. Důsledek ale byl, že fronta pro selhané úlohy nefungovala
   * ANI JEDNOU: pg-boss totiž neroutuje podle fronty, ale podle sloupce
   * `dead_letter` NA ŘÁDKU ÚLOHY. V `plans.js` to dělá CTE `dlq_jobs`:
   *
   *   INSERT INTO job (name, ...) SELECT r.dead_letter, ... FROM results r
   *
   * a distribuovaná cesta v `manager.js` totéž přes `if (job.dead_letter)`.
   * Náš INSERT nechával sloupec na NULL, takže se po vyčerpání pokusů úloha
   * uložila jako `failed` a NIKAM se nepřeposlala, ačkoli 47 front v registru
   * dead letter frontu má a `registerQueues` ji poctivě zakládá. Selhaná práce
   * neměla kam spadnout.
   *
   * Poddotaz ten cizí klíč neporušuje, a to je celý vtip: čte hodnotu, která
   * v `queue` UŽ JE, tedy buď `<fronta>.dlq` (fronta existuje, jinak by ji
   * `queue.dead_letter` nemohl mít) nebo NULL u front bez dead letter fronty.
   * Nemůže vzniknout jméno, které v `queue` není. Je to tentýž důvod, proč se
   * poddotazem čte i politika: jedna pravda, a to ta, kterou používá databáze.
   */
  return sql`
    INSERT INTO ${schema}.job
      (name, data, singleton_key, retry_limit, retry_backoff, expire_seconds, start_after,
       policy, dead_letter)
    VALUES (
      ${input.name},
      ${JSON.stringify(input.payload)}::jsonb,
      ${input.singletonKey ?? null},
      ${input.retryLimit ?? entry.retryLimit},
      ${input.retryBackoff ?? entry.retryBackoff},
      ${input.expireInSeconds ?? entry.expireInSeconds},
      now() + make_interval(secs => ${input.startAfterSeconds ?? 0}),
      (SELECT policy FROM ${schema}.queue WHERE name = ${input.name}),
      (SELECT dead_letter FROM ${schema}.queue WHERE name = ${input.name})
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
}

/**
 * Zařadí úlohu a podle `onMerged` rozhodne, co se stane, když ji politika
 * fronty nezařadí.
 *
 * `RETURNING id` je jediný způsob, jak sloučení POZNAT. Bez něj vypadá zahozená
 * úloha úplně stejně jako zařazená a volající nemá na čem stavět; přesně tak by
 * se ztratila kampaň, kterou uživatel odeslal.
 */
export async function enqueueJob(
  tx: JobExecutor,
  input: JobInsert & { readonly onMerged: OnMerged },
): Promise<boolean> {
  const { rows } = await tx.execute(jobInsert(input));
  const enqueued = rows.length > 0;
  if (!enqueued && input.onMerged === 'fail') {
    throw new JobNotEnqueuedError(input.name, input.singletonKey);
  }
  return enqueued;
}
