import { createSystemContext } from '../../identity/context';
import { processAsset } from '../service';

/**
 * Náklad fronty `content.process_asset`. Pole jsou zmrazená registrem front
 * (`queues/registry.ts`, `payloadFields: ['workspace_id', 'asset_id']`),
 * v camelCase, protože přesně tak je zapisuje producent.
 */
export type ProcessAssetPayload = { workspaceId: string; assetId: string };

/**
 * Přegenerování odvozených velikostí jednoho obrázku.
 *
 * K ČEMU TA FRONTA JE, KDYŽ NAHRÁVÁNÍ VARIANTY DĚLÁ SAMO. Nahrávání je volá
 * přímo a synchronně, protože specifikace 3.14.2 to vyžaduje: obrázek si
 * vyžádá schránka příjemce, ne náš server, takže líné generování by u kampaně
 * na 50 000 lidí znamenalo 50 000 souběžných požadavků na soubor, který ještě
 * neexistuje. Tahle fronta je pro DRUHÝ případ, který specifikace popisuje
 * v téže kapitole: přidání varianty do registru je „řádek v registru plus
 * jednorázový job, který ji dogeneruje ke stávajícím assetům".
 *
 * Obsluha je proto IDEMPOTENTNÍ a smí běžet nad assetem, který varianty už má:
 * čte originál z disku, spočítá varianty podle aktuálního registru a zapíše je
 * přes `ON CONFLICT DO UPDATE`. Bez toho by ji `retryLimit: 3` po prvním
 * síťovém zaškobrtnutí zasekl na porušení primárního klíče.
 *
 * Smazaný nebo uklizený asset NENÍ chyba: úloha mohla čekat ve frontě déle, než
 * asset žil. Vrací se nula variant a úloha končí úspěchem, aby neskončila
 * v dead letter kvůli něčemu, co je v pořádku.
 */
export async function processAssetJob(payload: ProcessAssetPayload): Promise<{ variants: number }> {
  const ctx = createSystemContext(payload.workspaceId, 'content.process_asset');
  return processAsset({ ctx }, payload.assetId);
}
