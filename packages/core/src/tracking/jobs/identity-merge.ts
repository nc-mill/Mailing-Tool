import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config/index';
import { queue } from '../../queues';
import type { Tx } from '../repo/tx';
import { trackingConfig } from '../config';
import { runIdentityMerge } from '../identity/merge';

export const IDENTITY_MERGE_QUEUE = 'identity.merge';

/** Náklad fronty. Jména polí odpovídají registru P01 (`payloadFields`). */
export type IdentityMergeJobData = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  bindingId: string;
};

/** Dávka slučování. Vyšší číslo neúměrně prodlužuje jednu transakci. */
const MERGE_BATCH_SIZE = 1000;

let cachedSchema: string | null = null;

function pgbossSchema(): string {
  // Konfigurace se čte líně a jednou: import modulu nesmí vyžadovat kompletní
  // prostředí, jinak se doména nedá naimportovat v jednotkovém testu.
  cachedSchema ??= loadConfig().PGBOSS_SCHEMA;
  return cachedSchema;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetIdentityMergeEnqueueConfig(): void {
  cachedSchema = null;
}

/**
 * Zařazení úlohy VE STEJNÉ TRANSAKCI jako vazba identity.
 *
 * Volat `boss.send()` mimo transakci není náhrada: úloha by přežila rollback
 * vazby a slučovala by historii k vazbě, která nakonec nevznikla. Zapisuje se
 * proto přímo do tabulky `job` ve schématu pg-boss, tedy jeho zveřejněným
 * způsobem transakčního vkládání, stejně jako v `contacts/jobs/enqueue.ts`.
 *
 * `singleton_key` je `binding_id` podle registru P01. Nezaručuje právě jedno
 * spuštění, jen to, že dvě úlohy nad touž vazbou nepoběží souběžně; zbytek
 * idempotence nese `runIdentityMerge`.
 *
 * `dead_letter` se ZÁMĚRNĚ nevyplňuje: sloupec má cizí klíč na `queue.name`,
 * takže hodnota `identity.merge.dlq` by zápis shodila všude, kde dead letter
 * frontu nikdo nezaložil. Přiřazení dead letter fronty patří do workeru.
 */
export async function enqueueIdentityMerge(tx: Tx, data: IdentityMergeJobData): Promise<void> {
  const entry = queue(IDENTITY_MERGE_QUEUE);
  await tx.execute(sql`
    INSERT INTO ${sql.identifier(pgbossSchema())}.job
      (name, data, singleton_key, retry_limit, retry_backoff, expire_seconds, start_after)
    VALUES (
      ${IDENTITY_MERGE_QUEUE},
      ${JSON.stringify(data)}::jsonb,
      ${data.bindingId},
      ${entry.retryLimit},
      ${entry.retryBackoff},
      ${entry.expireInSeconds},
      now()
    )
  `);
}

/**
 * Obsluha fronty `identity.merge`.
 *
 * Idempotence stojí na dvou věcech: `binding_id` je klíč běhu, takže hotový běh
 * se podruhé nespustí, a podmínka `contact_id IS NULL` v dotazu vyloučí už
 * převedené řádky, takže druhý běh po pádu workeru pokračuje tam, kde první
 * skončil. Ani jeden ze scénářů nezdvojí události ani řádky v `identity_merges`.
 */
export async function handleIdentityMerge(job: { data: IdentityMergeJobData }): Promise<void> {
  const config = trackingConfig();
  await runIdentityMerge({
    workspaceId: job.data.workspaceId,
    anonymousId: job.data.anonymousId,
    contactId: job.data.contactId,
    bindingId: job.data.bindingId,
    windowDays: config.mergeWindowDays,
    maxEvents: config.mergeMaxEvents,
    batchSize: MERGE_BATCH_SIZE,
    now: new Date(),
  });
}
