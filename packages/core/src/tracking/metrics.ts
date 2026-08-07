import type { ClickClass, OpenClass, TokenErrorCode } from './types';

/**
 * ODCHYLKA OD PLÁNU, a je vynucená. Plán psal
 * `import { counter, gauge, histogram } from '@mlain/core/metrics'`.
 * Modul `packages/core/src/metrics` v repozitáři NEEXISTUJE (ověřeno hledáním
 * napříč `packages` i `apps`) a vlastní ho P01, takže ho tenhle plán založit
 * nesmí. Sáhnout mimo `packages/core/src/tracking/**` nesmí taky.
 *
 * Primitiva jsou proto tady, v jediném souboru téhle domény, a jsou schválně
 * co nejmenší: drží jméno, popis, jména labelů a naměřené hodnoty. Až P01
 * registr dodá, přepíše se tenhle soubor na tři importy a katalog i volající
 * kód zůstanou beze změny, protože povrch (`inc`, `set`, `observe`) je stejný.
 *
 * Jediná závazná notace jmen je podtržítková, tečka v názvu metriky pro
 * Prometheus platná není.
 */

export type MetricLabels = Record<string, string>;

function labelKey(labels: MetricLabels | undefined): string {
  if (labels === undefined) return '';
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${labels[name] ?? ''}`)
    .join(',');
}

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {}
}

export class Counter extends Metric {
  readonly #values = new Map<string, number>();

  inc(labels?: MetricLabels, value = 1): void {
    const key = labelKey(labels);
    this.#values.set(key, (this.#values.get(key) ?? 0) + value);
  }

  get(labels?: MetricLabels): number {
    return this.#values.get(labelKey(labels)) ?? 0;
  }
}

export class Gauge extends Metric {
  readonly #values = new Map<string, number>();

  set(value: number, labels?: MetricLabels): void {
    this.#values.set(labelKey(labels), value);
  }

  inc(labels?: MetricLabels, value = 1): void {
    const key = labelKey(labels);
    this.#values.set(key, (this.#values.get(key) ?? 0) + value);
  }

  dec(labels?: MetricLabels, value = 1): void {
    this.inc(labels, -value);
  }

  get(labels?: MetricLabels): number {
    return this.#values.get(labelKey(labels)) ?? 0;
  }
}

export class Histogram extends Metric {
  readonly #sums = new Map<string, number>();
  readonly #counts = new Map<string, number>();

  observe(value: number, labels?: MetricLabels): void {
    const key = labelKey(labels);
    this.#sums.set(key, (this.#sums.get(key) ?? 0) + value);
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
  }

  sum(labels?: MetricLabels): number {
    return this.#sums.get(labelKey(labels)) ?? 0;
  }

  count(labels?: MetricLabels): number {
    return this.#counts.get(labelKey(labels)) ?? 0;
  }
}

function counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
  return new Counter(name, help, labelNames);
}

function gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
  return new Gauge(name, help, labelNames);
}

function histogram(name: string, help: string, labelNames: readonly string[] = []): Histogram {
  return new Histogram(name, help, labelNames);
}

/**
 * Katalog z 9.1 části 5. Jediná závazná notace je podtržítková.
 * Rozlišení podle druhu řeší label, ne další jméno metriky.
 */
export const TRACKING_METRIC_NAMES = [
  'tracking_open_total',
  'tracking_open_capped_total',
  'tracking_click_total',
  'tracking_token_invalid_total',
  'tracking_message_lookup_miss_total',
  'tracking_writer_buffer_size',
  'tracking_writer_dropped_total',
  'tracking_writer_flush_duration_seconds',
  'tracking_ingest_events_total',
  'tracking_ingest_duration_seconds',
  'tracking_ingest_truncated_total',
  'tracking_identity_bind_total',
  'tracking_identity_merge_events_total',
  'tracking_partition_missing',
  'tracking_redirect_duration_seconds',
] as const;

export const trackingMetrics = {
  openTotal: counter('tracking_open_total', 'Otevření podle třídy', ['class']),
  openCapped: counter('tracking_open_capped_total', 'Otevření zahozená stropem'),
  clickTotal: counter('tracking_click_total', 'Prokliky podle třídy', ['class']),
  tokenInvalid: counter('tracking_token_invalid_total', 'Neplatné tokeny podle kódu', ['code']),
  messageLookupMiss: counter(
    'tracking_message_lookup_miss_total',
    'Dohledání zprávy z tokenu neuspělo, alertované jako porušení invariantu I1',
  ),
  writerBufferSize: gauge('tracking_writer_buffer_size', 'Velikost bufferu zapisovače'),
  writerDropped: counter('tracking_writer_dropped_total', 'Zahozené položky bufferu'),
  writerFlushDuration: histogram('tracking_writer_flush_duration_seconds', 'Doba zápisu dávky'),
  ingestEvents: counter('tracking_ingest_events_total', 'Přijaté události', ['result']),
  ingestDuration: histogram('tracking_ingest_duration_seconds', 'Latence ingestion'),
  ingestTruncated: counter('tracking_ingest_truncated_total', 'Ořezy v properties', ['limit']),
  identityBind: counter('tracking_identity_bind_total', 'Výsledky vazby identity', ['result']),
  identityMergeEvents: counter(
    'tracking_identity_merge_events_total',
    'Doplněné události při slučování',
  ),
  partitionMissing: gauge('tracking_partition_missing', 'Chybí partition pro aktuální měsíc'),
  redirectDuration: histogram('tracking_redirect_duration_seconds', 'Latence přesměrování'),
};

export function recordOpen(cls: OpenClass): void {
  trackingMetrics.openTotal.inc({ class: cls });
}

export function recordClick(cls: ClickClass): void {
  trackingMetrics.clickTotal.inc({ class: cls });
}

export function recordTokenInvalid(code: TokenErrorCode): void {
  trackingMetrics.tokenInvalid.inc({ code });
}

// `contact_not_found` je doplněk proti plánu: `bindIdentity` ho vrací, když
// kontakt z tokenu mezitím zmizel, a bez labelu by takový případ v metrice
// nebyl vidět vůbec.
export type IdentityBindResult =
  | 'created'
  | 'bound'
  | 'unchanged'
  | 'rebound'
  | 'restricted'
  // Odvolaný souhlas s měřením má vlastní hodnotu, ne `restricted`: obojí vazbu
  // odmítne, ale je to jiný důvod a v grafu se musí dát odlišit. Bez toho by
  // provozovatel viděl růst „omezené zpracování" a hledal by žádosti podle
  // článku 18, které nikdo nepodal.
  | 'measurement_withdrawn'
  | 'shared'
  | 'contact_not_found';

export function recordIdentityBind(result: IdentityBindResult): void {
  trackingMetrics.identityBind.inc({ result });
}
