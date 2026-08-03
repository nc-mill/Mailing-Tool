import type { ErrorDomain } from '../errors/types';

export interface QueueEntry {
  /** Název ve tvaru <domena>.<akce>, opsaný ze specifikace doslova. */
  readonly name: string;
  readonly domain: ErrorDomain;
  /** Který plán dodá handler. Registr vlastní P01, handler ne. */
  readonly owner: string;
  readonly description: string;
  /** Cron výraz pro boss.schedule. Chybí u front spouštěných na požádání. */
  readonly cron?: string;
  /** Explicitně, konvence 9.1 zakazuje spoléhat na výchozí hodnoty. */
  readonly retryLimit: number;
  readonly retryBackoff: boolean;
  readonly retryDelaySeconds: number;
  readonly expireInSeconds: number;
  /** Tvar singletonKey, když ho fronta používá. `global` = jeden běh v instalaci. */
  readonly singletonKeyTemplate?: string;
  /** Fronta smí trvale selhat a má proto <name>.dlq. */
  readonly deadLetter: boolean;
  /** Souběžnost, když se liší od WORKER_CONCURRENCY. */
  readonly concurrency?: number;
  /** Názvy polí payloadu. Slouží testu, který hlídá zákaz osobních údajů. */
  readonly payloadFields: readonly string[];
  /** Kapitola specifikace, ze které politika pochází. */
  readonly source: string;
}

export interface QueueJob<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly data: TPayload;
}

/**
 * Obsluha DÁVKY úloh, protože přesně tak ji volá pg-boss.
 *
 * Domény, které pracují s jednou úlohou (a to jsou skoro všechny), si dávku
 * rozbalí adaptérem `perJob` z tohohle modulu. Kdo si adaptér nepřidá, dostane
 * pole tam, kde čeká objekt, sáhne na `.data` a dostane `undefined`.
 *
 * Nekontroluje to nic za běhu: fronty se zaregistrují, worker naběhne
 * a projeví se to teprve na první skutečně zpracované úloze. Typová kontrola
 * je tu tedy jediná pojistka a nesmí se obcházet.
 */
export type QueueHandler = (jobs: readonly QueueJob[]) => Promise<void>;

/**
 * Převod obsluhy jedné úlohy na obsluhu dávky.
 *
 * Bydlí tady, ne v jednotlivých doménách. Původně ho měla jen `platform`
 * a ostatní domény vystavovaly obsluhu jedné úlohy rovnou jako `QueueHandler`,
 * takže neseděl typ ani chování.
 */
export function perJob<TData>(run: (job: { data: TData }) => Promise<unknown>): QueueHandler {
  return async (jobs) => {
    for (const job of jobs) {
      await run({ data: job.data as TData });
    }
  };
}

/**
 * Obsluha úlohy BEZ nákladu: proběhne jednou za dávku, ne jednou za úlohu.
 *
 * Přesně takhle vypadají cronové úlohy (plánovač kampaní, hlídač běžících,
 * obnova po kvótě, úklidy platformy): pg-boss jim doručí prázdný objekt a víc
 * jich v dávce znamená jen to, že se natikalo víc prázdných úloh, ne víc práce.
 * S `perJob` by takový sken proběhl tolikrát, kolik je úloh v dávce, a druhý
 * průchod by nenašel nic. Škodilo by to hlavně u plánovače, kde se mezi
 * průchody nestihne nic změnit, takže by šlo o čistou zátěž navíc.
 *
 * Bydlí tady, ne v `platform/jobs`, kde vzniklo. Doména platformy ho měla jako
 * lokální funkci a doména kampaní by ho musela opsat; dvě kopie by se lišily
 * v tom, jestli se výsledek čeká.
 */
export function once(run: () => Promise<unknown>): QueueHandler {
  return async () => {
    await run();
  };
}

/**
 * Obsluha, která potřebuje injektované závislosti, jenže je nikdo nedodává.
 *
 * Týká se `content.brand_extract` a `ai.cleanup_conversations`: obě funkce
 * existují a mají testy, ale továrna jejich `deps` v repu není, takže je nemá
 * kdo složit. Bez tohohle by se do registru dostaly s typem, který lže, nebo
 * by se z něj tiše vypustily a fronta by neměla obsluhu vůbec.
 *
 * Takhle se fronta zaregistruje, worker naběhne a při první úloze řekne
 * NAHLAS, co chybí. Úloha skončí v chybě a půjde po ní dohledat, na rozdíl od
 * `undefined` v datech nebo od fronty, do které nikdo nekouká.
 */
export function needsDependencies(queue: string, missing: string): QueueHandler {
  const handler: QueueHandler = async () => {
    throw new Error(
      `Fronta ${queue} nemá zapojené závislosti: ${missing} nikdo nedodává. ` +
        'Obsluha existuje, ale nedá se složit, takže se úloha nezpracuje.',
    );
  };
  // Značka pro testy pokrytí front. Bez ní se nedodaná obsluha nedá odlišit od
  // složené: obě jsou `function` a obě se v mapě `handlers` tváří stejně, takže
  // by `typeof HANDLERS[name] === 'function'` propustilo i frontu, která každou
  // úlohu shodí. Spustit obsluhu naprázdno jako rozlišovač nestačí, `once`
  // by přitom udělal skutečnou práci.
  return Object.assign(handler, { missingDependencies: missing });
}

/** Vrátí důvod, proč obsluha není složená, nebo `undefined` u složené obsluhy. */
export function missingDependenciesOf(handler: QueueHandler): string | undefined {
  return (handler as { missingDependencies?: string }).missingDependencies;
}
