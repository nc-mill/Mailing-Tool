import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config/index';
import { queue } from '../../queues/registry';
import type { Tx } from '../../tx';

/**
 * Zařazení jobu VE STEJNÉ TRANSAKCI jako doménová změna.
 *
 * Politika fronty se NEOPISUJE, čte se z registru P01 přes `queue(name)`.
 * Dvě kopie retry a expirace by se rozešly a rozdíl by se projevil jako job,
 * který se v produkci chová jinak než ve workeru.
 *
 * Zapisuje se přímo do tabulky `job` ve schématu pg-boss, což je jeho zveřejněný
 * způsob transakčního vkládání. `boss.send()` mimo transakci není náhrada:
 * job by přežil rollback doménové změny a přepočítával by segment, jehož
 * založení se nakonec nepovedlo.
 *
 * `dead_letter` se ZÁMĚRNĚ nevyplňuje: sloupec má cizí klíč na `queue.name`,
 * takže hodnota `<fronta>.dlq` by zápis shodila všude, kde dead letter frontu
 * nikdo nezaložil. Přiřazení dead letter fronty patří k založení fronty.
 */
export type EnqueueOptions = {
  /** Jeden běh nad jedním klíčem. Negarantuje právě jedno spuštění. */
  singletonKey?: string;
  startAfterSeconds?: number;
};

let cachedSchema: string | null = null;

function pgbossSchema(): string {
  cachedSchema ??= loadConfig().PGBOSS_SCHEMA;
  return cachedSchema;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetSegmentEnqueueConfig(): void {
  cachedSchema = null;
}

export async function enqueueSegmentJob(
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
      ${entry.retryLimit},
      ${entry.retryBackoff},
      ${entry.expireInSeconds},
      now() + make_interval(secs => ${options.startAfterSeconds ?? 0})
    )
  `);
}
