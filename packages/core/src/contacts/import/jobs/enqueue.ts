import { sql } from 'drizzle-orm';
import { loadConfig } from '../../../config/index';
import { queue } from '../../../queues/registry';
import type { Tx } from '../../../tx';

/**
 * Zařazení jobu VE STEJNÉ TRANSAKCI jako doménová změna. Politika fronty se
 * NEOPISUJE, čte se z registru P01 přes `queue(name)`.
 *
 * `boss.send()` mimo transakci není náhrada: job by přežil rollback doménové
 * změny a spustil by import, jehož potvrzení se nakonec nepovedlo.
 */
export type EnqueueOptions = {
  /** Jeden běh nad jedním klíčem. Negarantuje právě jedno spuštění. */
  singletonKey?: string;
  startAfterSeconds?: number;
  /**
   * NÁLEZ PROTI P01, ZAPSANÝ JAKO PARAMETR. Registr má u `contacts.import`
   * `retryLimit: 3`, ale rozpracovaný import se po pádu NESMÍ spustit znovu
   * od začátku: to by naimportovalo už zapsané řádky podruhé. Obnovu řídí
   * `recover-stale.ts` podle `imports.updated_at`, takže import se zařazuje
   * s `retryLimit = 0`. Ostatní hodnoty politiky se dál čtou z registru.
   */
  retryLimitOverride?: number;
};

let cachedSchema: string | null = null;

function pgbossSchema(): string {
  cachedSchema ??= loadConfig().PGBOSS_SCHEMA;
  return cachedSchema;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetImportEnqueueConfig(): void {
  cachedSchema = null;
}

export async function enqueueImportJob(
  tx: Tx,
  name: string,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<void> {
  const entry = queue(name);
  await tx.execute(sql`
    INSERT INTO ${sql.identifier(pgbossSchema())}.job
      (name, data, singleton_key, retry_limit, retry_backoff, expire_seconds, start_after)
    VALUES (
      ${name},
      ${JSON.stringify(payload)}::jsonb,
      ${options.singletonKey ?? null},
      ${options.retryLimitOverride ?? entry.retryLimit},
      ${entry.retryBackoff},
      ${entry.expireInSeconds},
      now() + make_interval(secs => ${options.startAfterSeconds ?? 0})
    )
  `);
}
