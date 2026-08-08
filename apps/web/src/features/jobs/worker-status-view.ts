/**
 * Tvar odpovědi `/api/v1/jobs/worker`, doslova podle `WorkerStatusSchema`
 * v `packages/core/src/platform/api/jobs.routes.ts`. Kdyby se rozešly,
 * obrazovka by tiše kreslila nuly místo chyby.
 */
export type WorkerState = 'running' | 'late' | 'down' | 'unknown';

export type ApiQueueFailure = {
  queue: string;
  description: string;
  failures: number;
  last_failure_at: string | null;
  last_success_at: string | null;
  recovered: boolean;
};

export type ApiDeadLetterItem = {
  queue: string;
  description: string;
  at: string | null;
  reason: string;
};

export type ApiWorkerStatus = {
  state: WorkerState;
  last_seen_at: string | null;
  seconds_since_last_seen: number | null;
  queue: {
    waiting: number;
    running: number;
    /** Selhání ZA OKNO `failed_window_hours`, ne za celou historii. */
    failed_recent: number;
    /**
     * Rozpis pádů po frontách. `recovered` je tvrzení o FRONTĚ, ne o té
     * konkrétní úloze: zotavená fronta znamená, že mechanismus jede dál, ne že
     * se dokončila práce, která spadla. Ta leží v `dead_letter_items`.
     */
    failures: ApiQueueFailure[];
    failed_window_hours: number;
    dead_letter: number;
    dead_letter_items: ApiDeadLetterItem[];
  };
  queues: { registered: number; cron_expected: number; cron_scheduled: number };
};

export type WorkerStatusResponse = { worker: ApiWorkerStatus };

/**
 * Klíč překladu se nesmí skládat za běhu (konvence 3.9 části 1), proto mapa.
 * Stavy jsou doslova ty z `WorkerState` v jádře; kdyby přibyl další, spadne
 * tady TypeScript dřív, než uživatel uvidí prázdný odznak.
 */
export const WORKER_STATE_KEYS = {
  running: 'jobs.workerRunning',
  late: 'jobs.workerLate',
  down: 'jobs.workerDown',
  unknown: 'jobs.workerUnknown',
} as const satisfies Record<WorkerState, string>;

/**
 * Tón odznaku u stavu workeru.
 *
 * `unknown` je `neutral`, NE `danger`, a je to rozdíl, na kterém záleží.
 * Znamená „nedalo se změřit nic", typicky proto, že instalace nemá schéma
 * fronty. Červená by ukázala prstem na worker, který možná běží úplně v pořádku,
 * a poslala by člověka hledat na nesprávné místo.
 */
export function workerStateTone(state: WorkerState): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (state) {
    case 'running':
      return 'success';
    case 'late':
      return 'warning';
    case 'down':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Má panel křičet? Rozhoduje se podle DVOU věcí, ne jen podle stavu workeru.
 *
 * Běžící worker s plnou dead letter frontou je pořád porucha: úlohy se
 * nepovedlo dokončit ani po všech pokusech, leží stranou a NIKDO je nevezme.
 * Kdyby panel koukal jen na `state`, tvářil by se v tom případě zeleně.
 *
 * Počet SELHÁNÍ sem schválně nepatří ani teď, když se počítá za den. Selhání
 * je běžný provoz: fronta má pokusy a další z nich se povede. Poplach patří
 * až tomu, co se samo nespraví, a to je dead letter.
 */
export function workerNeedsAttention(worker: ApiWorkerStatus): boolean {
  return worker.state === 'late' || worker.state === 'down' || worker.queue.dead_letter > 0;
}

/**
 * Kolik cronových front nemá čím tikat.
 *
 * Není to odhad: `registerQueues` cronovou frontu BEZ OBSLUHY neplánuje
 * a její případný starý plán ruší, aby tik neuvízl ve frontě, kterou nikdo
 * nečte. Rozdíl mezi tím, kolik front má podle registru tikat, a tím, kolik
 * jich plán doopravdy má, je tedy počet cronových front, které tenhle build
 * neumí obsloužit.
 */
/**
 * Fronty, které od posledního pádu ZNOVU NEPROBĚHLY.
 *
 * Tohle je ta hranice mezi „bylo to a spravilo se" a „trvá to". Bez ní panel
 * hlásil poplach i nad pády z uzavřené epizody, po které všechny fronty zase
 * jedou, a uživatel z toho usoudil, že systém nefunguje.
 */
export function stuckQueues(worker: ApiWorkerStatus): ApiQueueFailure[] {
  return worker.queue.failures.filter((failure) => !failure.recovered);
}

export function cronQueuesWithoutHandler(worker: ApiWorkerStatus): number {
  return Math.max(worker.queues.cron_expected - worker.queues.cron_scheduled, 0);
}
