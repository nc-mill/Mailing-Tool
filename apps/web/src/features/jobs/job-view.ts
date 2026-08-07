import type { JobStatus } from '@mlain/ui/patterns/jobs';

/**
 * Tvar úlohy, jak ho vydává `/api/v1/jobs`. Doslova podle `JobSchema`
 * v `packages/core/src/platform/api/jobs.routes.ts`: kdyby se rozešly,
 * obrazovka by tiše kreslila prázdné hodnoty místo chyby.
 */
export type ApiJob = {
  id: string;
  kind: string;
  title: string;
  status: JobStatus;
  done: number;
  total: number;
  started_by: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  note: string | null;
  /** Jde úloha zastavit teď? Podle toho se tlačítko ZOBRAZÍ, nebo nezobrazí. */
  can_cancel: boolean;
  /** Zrušení už bylo vyžádané a běh dobíhá rozpracovanou dávku. */
  stopping: boolean;
};

export type JobsResponse = {
  data: ApiJob[];
  running_count: number;
  /** Kolik úloh má projekt celkem. Patička tabulky bez toho píše „50 z 50". */
  total: number;
  /** Kurzor na další stránku, nebo `null`, když další už není. */
  next_before: string | null;
};

/** Klíč úlohy napříč zdroji. ID samo o sobě jedinečné NENÍ, viz komentář u API. */
export function jobKey(job: Pick<ApiJob, 'kind' | 'id'>): string {
  return `${job.kind}:${job.id}`;
}

/**
 * Přidá další stránku historie pod už zobrazený seznam.
 *
 * ČERSTVÁ VERZE VYHRÁVÁ a řadí se znovu podle poslední změny: úloha se mezi
 * dvěma dotazy může posunout nahoru a bez přeřazení by zůstala viset na starém
 * místě. Slévá se podle dvojice `kind` + `id`, protože ID nejsou napříč zdroji
 * zaručeně jedinečná; bez toho by se přesunutá úloha objevila dvakrát.
 */
export function mergeJobs(previous: ApiJob[], incoming: ApiJob[]): ApiJob[] {
  const byKey = new Map(previous.map((job) => [jobKey(job), job]));
  for (const job of incoming) byKey.set(jobKey(job), job);
  return [...byKey.values()].sort((a, b) =>
    a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
  );
}

/**
 * Obnovení: PRVNÍ STRÁNKA SE NAHRADÍ, dolistovaná historie pod ní zůstane.
 *
 * PROČ SE OBNOVUJE JEN PRVNÍ STRÁNKA. Seznam jde podle poslední změny sestupně,
 * takže úloha, se kterou se právě hýbe, je vždycky na ní; a když doběhne,
 * dostane čerstvý čas a na první stránku se přesune taky. Tahat při každém
 * tiknutí i historii by znamenalo číst data, o kterých se ví, že se nezměnila.
 *
 * PROČ SE NAHRAZUJE, A NESLÉVÁ. Slití by nikdy nic neodebralo, takže úloha,
 * která z první stránky ZMIZELA (posunula se níž, nebo přestala existovat),
 * by na obrazovce zůstala navždy. Hranicí je poslední úloha čerstvé stránky:
 * co je starší, patří do historie a zůstává; co je novější, přišlo z odpovědi.
 *
 * `hasMore` říká, jestli za čerstvou stránkou vůbec něco je. Když ne, je
 * odpověď CELÝ seznam a historie se zahazuje: jinak by po smazání úloh zůstaly
 * na obrazovce řádky, které už na serveru nejsou.
 */
export function replaceFirstPage(previous: ApiJob[], fresh: ApiJob[], hasMore: boolean): ApiJob[] {
  if (!hasMore) return fresh;
  const oldest = fresh.at(-1);
  if (!oldest) return previous;
  const freshKeys = new Set(fresh.map(jobKey));
  const tail = previous.filter(
    (job) => job.updated_at < oldest.updated_at && !freshKeys.has(jobKey(job)),
  );
  return [...fresh, ...tail];
}

/** Výsledek zastavení tak, jak ho vydává `POST /api/v1/jobs/{kind}/{id}/cancel`. */
export type JobCancelOutcome = 'cancelling' | 'already_cancelled' | 'already_finished';
export type JobCancelResponse = { outcome: JobCancelOutcome; job: ApiJob };

/**
 * Klíč překladu se nesmí skládat za běhu (konvence 3.9 části 1), proto mapa.
 * Stavy jsou doslova ty z `JOB_STATUSES` v jádře; kdyby přibyl další,
 * TypeScript tady spadne dřív, než uživatel uvidí prázdný odznak.
 */
export const JOB_STATUS_KEYS = {
  running: 'jobs.statusRunning',
  paused: 'jobs.statusPaused',
  completed: 'jobs.statusCompleted',
  completedWithErrors: 'jobs.statusCompletedWithErrors',
  failed: 'jobs.statusFailed',
  cancelled: 'jobs.statusCancelled',
} as const satisfies Record<JobStatus, string>;

/**
 * Popisek stavu. `stopping` je SILNĚJŠÍ než `status`, a je to celý smysl toho
 * příznaku: zrušení se zapíše hned, ale běh se zastaví až u nejbližší kontroly.
 * Kdyby řádek v tu chvíli tvrdil „Zrušeno", říkal by o rozepsané dávce, která
 * ještě zapisuje kontakty, že žádná není.
 */
export function jobStatusKey(job: Pick<ApiJob, 'status' | 'stopping'>): string {
  return job.stopping ? 'jobs.statusStopping' : JOB_STATUS_KEYS[job.status];
}

/**
 * Druh úlohy na název, který něco říká. `kind` je otevřený seznam: registr
 * zdrojů je schválně rozšiřitelný, takže neznámý druh nesmí obrazovku shodit
 * ani na ni napsat `campaign_audience`.
 */
const JOB_KIND_KEYS: Record<string, string> = {
  import: 'jobs.kindImport',
  campaign_audience: 'jobs.kindCampaignAudience',
};

export function jobKindKey(kind: string): string {
  return JOB_KIND_KEYS[kind] ?? 'jobs.kindUnknown';
}

/** Odznak stavu má tón, ne jen barvu textu. Slovo nese `Badge` sám. */
export function jobStatusTone(
  status: JobStatus,
): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'running':
      return 'accent';
    case 'paused':
      return 'warning';
    case 'completed':
      return 'success';
    case 'completedWithErrors':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Odkaz na obrazovku, která o úloze ví všechno: import má vlastní průběh,
 * kampaň vlastní detail. Neznámý druh odkaz nedostane, protože vymyšlená cesta
 * skončí na 404 a to je horší než chybějící tlačítko.
 */
export function jobSourceLink(
  job: Pick<ApiJob, 'kind' | 'id' | 'status'>,
  workspaceSlug: string,
): { href: string; labelKey: string } | null {
  if (job.kind === 'import') {
    /*
     * ROZDĚLANÝ IMPORT PATŘÍ DO PRŮVODCE, dokončený na výsledek.
     *
     * Odkaz mířil vždycky na `/contacts/import/{id}`, tedy na VÝSLEDEK. Import,
     * který se nikdy nespustil a leží ve stavu `previewing`, ale žádný výsledek
     * nemá: chybí mu potvrzení mapování sloupců, tedy krok průvodce. Naměřeno
     * 7. 8. 2026 na skutečném případu, kdy zadavateli zůstal rozdělaný import
     * a v rozhraní ho neměl jak spustit; adresu si musel vyžádat.
     *
     * Rozhoduje `paused`, ne výčet vnitřních stavů importu. `paused` znamená
     * podle `built-in-sources.ts` právě jedno: čeká se na ČLOVĚKA a samo se nic
     * nestane. To je definice rozdělaného průvodce a drží i pro `pending`, tedy
     * nahraný soubor, u kterého člověk zavřel okno hned po nahrání.
     *
     * Krok se schválně NEURČUJE. Průvodce si sám najde, kde člověk skončil,
     * a hádat to z Centra úloh by znamenalo druhé místo, které tutéž věc počítá
     * podle vlastních pravidel; ta dvě by se rozešla.
     */
    if (job.status === 'paused') {
      return {
        href: `/w/${workspaceSlug}/contacts/import?import=${encodeURIComponent(job.id)}`,
        labelKey: 'jobs.resumeImport',
      };
    }
    return {
      href: `/w/${workspaceSlug}/contacts/import/${job.id}`,
      labelKey: 'jobs.openImport',
    };
  }
  if (job.kind === 'campaign_audience') {
    return { href: `/w/${workspaceSlug}/campaigns/${job.id}`, labelKey: 'jobs.openCampaign' };
  }
  return null;
}

/** Cesta na detail úlohy. `kind` je v ní schválně, viz komentář u API. */
export function jobDetailHref(job: Pick<ApiJob, 'kind' | 'id'>, workspaceSlug: string): string {
  return `/w/${workspaceSlug}/jobs/${encodeURIComponent(job.kind)}/${encodeURIComponent(job.id)}`;
}

/**
 * Poznámka k řádku: co je na úloze potřeba říct slovy vedle odznaku stavu.
 *
 * Vzniklo rozpadem `toJobSummary`, který skládal celou kartu pro `JobsCenter`.
 * Karty 7. 8. nahradila `DataTable` a s ní zanikla i většina toho převodu;
 * tahle část ale zůstává, protože ji nenese žádný sloupec: `stopping` ani kód
 * selhání nejsou stav, jsou to věty k němu.
 *
 * ZASTAVOVÁNÍ JDE PŘED KÓD CHYBY: dokud běh dobíhá, je to ta novější
 * a užitečnější informace. Ani jedno ale druhé nevytlačí.
 */
export function jobNote(
  job: Pick<ApiJob, 'stopping' | 'note'>,
  labels: { failureCode: (code: string) => string; stopping: string },
): string | null {
  const notes = [
    ...(job.stopping ? [labels.stopping] : []),
    ...(job.note ? [labels.failureCode(job.note)] : []),
  ];
  return notes.length > 0 ? notes.join(' ') : null;
}
