import { loadConfig } from '../../config/index';
import { enqueueJob, type OnMerged } from '../../queues/enqueue-sql';
import type { Tx } from '../repo/tx';

/**
 * Zařazení úlohy VE STEJNÉ TRANSAKCI jako doménový zápis.
 *
 * Volat `boss.send()` mimo transakci není náhrada: úloha by přežila rollback
 * zápisu a agregovala by události, které nakonec nevznikly. Zapisuje se proto
 * přímo do tabulky `job` ve schématu pg-boss, tedy jeho zveřejněným způsobem
 * transakčního vkládání, stejně jako v `contacts/jobs/enqueue.ts`.
 *
 * `dead_letter` se ZÁMĚRNĚ nevyplňuje: sloupec má cizí klíč na `queue.name`,
 * takže hodnota `<fronta>.dlq` by zápis shodila všude, kde tu frontu nikdo
 * nezaložil. Přiřazení dead letter fronty patří k založení fronty, tedy
 * do workeru.
 *
 * Parametry opakování a expirace se berou Z REGISTRU P01, ne z výchozích hodnot
 * tabulky. Registr je jediný zdroj politiky fronty; výchozí hodnoty tabulky
 * pochází z pg-boss a s ním se můžou změnit pod rukama.
 */
let cachedSchema: string | null = null;

function pgbossSchema(): string {
  // Konfigurace se čte líně a jednou: import modulu nesmí vyžadovat kompletní
  // prostředí, jinak se doména nedá naimportovat v jednotkovém testu.
  cachedSchema ??= loadConfig().PGBOSS_SCHEMA;
  return cachedSchema;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetTrackingEnqueueConfig(): void {
  cachedSchema = null;
}

export type TrackingEnqueueOptions = {
  /** Jeden běh nad jedním klíčem. Nezaručuje právě jedno spuštění. */
  singletonKey?: string;
  /** Přebití výchozího `drop`. Viz rozvaha v hlavičce souboru. */
  onMerged?: OnMerged;
};

export async function enqueueTrackingJob(
  tx: Tx,
  name: string,
  payload: Record<string, unknown>,
  options: TrackingEnqueueOptions = {},
): Promise<void> {
  await enqueueJob(tx, {
    schema: pgbossSchema(),
    name,
    payload,
    singletonKey: options.singletonKey,
    onMerged: options.onMerged ?? 'drop',
  });
}
