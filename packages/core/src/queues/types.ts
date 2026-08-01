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

export type QueueHandler = (jobs: readonly QueueJob[]) => Promise<void>;
