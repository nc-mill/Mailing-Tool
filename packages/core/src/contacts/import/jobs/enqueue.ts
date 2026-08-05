import { loadConfig } from '../../../config/index';
import { enqueueJob, type OnMerged } from '../../../queues/enqueue-sql';
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
  /**
   * VÝCHOZÍ JE `fail`, A JE TO OPAK ZBYTKU PRODUKTU. Fronta `contacts.import` má
   * politiku `exclusive`, takže se druhá úloha s týmž klíčem nezařadí. Na import
   * ale čeká ČLOVĚK: kdyby se zařazení tiše zahodilo, zůstal by řádek v `imports`
   * ve stavu, ze kterého ho nikdo nevytáhne, a uživatel by koukal na „připravuje se"
   * navždy. Tichý drop je tu tedy ztráta práce, ne úspora.
   *
   * Klíč je ID importu, takže při běžném nahrání kolize nastat NEMŮŽE (řádek vzniká
   * v téže transakci a jeho ID je nové). Když nastane, znamená to, že tentýž import
   * už běží, a to je informace, kterou volající chce dostat.
   *
   * Obnova po pádu (`recover-stale.ts`) je jediná výjimka a předává `drop`: ta se
   * s běžícím během plete schválně a zahození je přesně to, co má nastat.
   */
  onMerged?: OnMerged;
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
  await enqueueJob(tx, {
    schema: pgbossSchema(),
    name,
    payload,
    singletonKey: options.singletonKey,
    startAfterSeconds: options.startAfterSeconds,
    retryLimit: options.retryLimitOverride,
    onMerged: options.onMerged ?? 'fail',
  });
}
