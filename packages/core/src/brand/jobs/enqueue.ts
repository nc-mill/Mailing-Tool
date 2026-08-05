import { loadConfig } from '../../config/index';
import { enqueueJob, type OnMerged } from '../../queues/enqueue-sql';
import type { Tx } from '../../tx';

/**
 * Zařazení jobu VE STEJNÉ TRANSAKCI jako doménová změna.
 *
 * Doména značky potřebuje zařadit jedinou úlohu, `platform.webhook_fanout`,
 * a to hned vedle zápisu do `webhook_events`. Kdyby se zařadilo mimo transakci,
 * přežil by fan-out rollback zápisu a rozeslal by událost, která v tabulce
 * není. Kdyby se nezařadilo vůbec, událost by v tabulce ležela a nikdo by ji
 * nerozeslal: `fanoutEvent` volá výhradně ten job a ten se sám nezařadí.
 *
 * Vlastní SQL sestavuje `queues/enqueue-sql.ts`, protože týž příkaz potřebuje sedm
 * domén a sedm kopií se rozešlo: všem chyběl sloupec `policy`, takže `singletonKey`
 * neslučoval nic.
 *
 * VÝCHOZÍ `onMerged` JE `fail`. Doména zařazuje dvě fronty a rozhodující je
 * `content.brand_extract` s politikou `exclusive`: na analýzu značky čeká uživatel
 * u obrazovky. Kdyby se zařazení tiše zahodilo, zůstal by řádek v `brand_extractions`
 * ve stavu `pending` a nikdo by ho nedokončil. Klíč je ID extrakce, které vzniká
 * v téže transakci, takže při běžném běhu kolize nastat nemůže; když nastane, je to
 * porucha a má být vidět.
 *
 * `platform.webhook_fanout` slučování zapnuté NEMÁ, takže se u ní zahodit nedá nic
 * a volba `fail` na ni nedopadá.
 */
export async function enqueueBrandJob(
  tx: Tx,
  name: string,
  payload: Record<string, unknown>,
  options: { singletonKey?: string; onMerged?: OnMerged } = {},
): Promise<void> {
  // Konfigurace se čte uvnitř funkce. Na úrovni modulu by `loadConfig()`
  // shodila každý jednotkový test, který se souboru jen dotkne.
  await enqueueJob(tx, {
    schema: loadConfig().PGBOSS_SCHEMA,
    name,
    payload,
    singletonKey: options.singletonKey,
    onMerged: options.onMerged ?? 'fail',
  });
}
