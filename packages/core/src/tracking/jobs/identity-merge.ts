import { loadConfig } from '../../config/index';
import { enqueueJob } from '../../queues/enqueue-sql';
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
 * vazby a slučovala by historii k vazbě, která nakonec nevznikla. Vlastní SQL
 * sestavuje `queues/enqueue-sql.ts`; tenhle soubor byl posledním ze sedmi míst,
 * která si vkládací příkaz psala sama, a všem sedmi chyběl sloupec `policy`,
 * takže `singletonKey` neslučoval NIC.
 *
 * `singleton_key` je `binding_id` podle registru P01. Nezaručuje právě jedno
 * spuštění, jen to, že dvě úlohy nad touž vazbou nepoběží souběžně; zbytek
 * idempotence nese `runIdentityMerge`.
 *
 * `onMerged` JE `drop`. Fronta má politiku `exclusive`, takže se druhé zařazení nad
 * TOUŽ vazbou nezařadí, a to je správný výsledek: klíč je `binding_id`, takže se
 * zahodí jedině požadavek na svázání, které už čeká nebo běží. Práci drží řádek
 * vazby, přepis historie je idempotentní a na výsledek nikdo nečeká u obrazovky
 * (identifikace se projeví při dalším průchodu). Vazby různých kontaktů mají různý
 * klíč, takže se mezi sebou nezahazují.
 */
export async function enqueueIdentityMerge(tx: Tx, data: IdentityMergeJobData): Promise<void> {
  await enqueueJob(tx, {
    schema: pgbossSchema(),
    name: IDENTITY_MERGE_QUEUE,
    payload: data,
    singletonKey: data.bindingId,
    onMerged: 'drop',
  });
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
