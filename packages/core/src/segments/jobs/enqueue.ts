import { loadConfig } from '../../config/index';
import { enqueueJob, type OnMerged } from '../../queues/enqueue-sql';
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
 * VÝCHOZÍ `onMerged` JE `drop`. Doména zařazuje jedinou slučující frontu,
 * `segments.recount` s politikou `short`, a tam je zahození SPRÁVNÝ výsledek:
 * `short` zahodí teprve TŘETÍ požadavek, tedy stav „jeden přepočet běží a jeden
 * čeká". Čekající přepočet si členy segmentu spočítá z aktuálních dat, až na něj
 * přijde řada, takže pokryje i tu změnu, kvůli které přišel zahozený požadavek.
 * Výsledný počet je správný tak jako tak; ušetří se jen běh navíc.
 *
 * Na `fail` tu není nic, protože na přepočet nečeká člověk u obrazovky: segment
 * se zobrazuje s posledním známým počtem a novým ho přepíše doběhlý přepočet.
 */
export type EnqueueOptions = {
  /** Jeden běh nad jedním klíčem. Negarantuje právě jedno spuštění. */
  singletonKey?: string;
  startAfterSeconds?: number;
  /** Přebití výchozího `drop`. Viz rozvaha v hlavičce souboru. */
  onMerged?: OnMerged;
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
  await enqueueJob(tx, {
    schema: pgbossSchema(),
    name,
    payload,
    singletonKey: options.singletonKey,
    startAfterSeconds: options.startAfterSeconds,
    onMerged: options.onMerged ?? 'drop',
  });
}
