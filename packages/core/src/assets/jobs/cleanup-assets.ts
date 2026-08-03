import { createSystemContext } from '../../identity/context';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { withWorkspace } from '../../tx';
import { listPurgeCandidates } from '../repository';
import { purgeAsset } from '../service';

/**
 * Fyzické mazání skrytých obrázků po lhůtě (`content.cleanup_assets`, cron 3:20).
 *
 * LHŮTA JE 30 DNÍ a je v aplikaci, ne v databázi. Specifikace 3.14.5 to určuje
 * jako chování produktu; kdyby ji hlídala politika nebo constraint, zkrácení
 * lhůty by znamenalo migraci u každé self-hosted instalace.
 */
export const PURGE_AFTER_DAYS = 30;

/** Strop na jeden projekt a jeden běh. Cron tiká denně, takže se to dožene. */
const BATCH_PER_WORKSPACE = 200;

export type CleanupAssetsDeps = {
  listWorkspaces(): Promise<string[]>;
  purgeAfterDays?: number;
};

export type CleanupAssetsResult = { workspaces: number; purged: number };

/**
 * Cronový tik.
 *
 * NEZASTAVUJE SE NA PRVNÍ CHYBĚ, ze stejného důvodu jako dispečer retence:
 * jeden projekt s nedostupným svazkem by jinak sebral úklid všem projektům za
 * sebou. Chyby se sesbírají, ostatní projekty se doklidí, a teprve pak úloha
 * spadne se seznamem projektů, kde to neprošlo.
 *
 * MAZÁNÍ SAMO je v `purgeAsset` a nejdůležitější kus je tam: soubor se smaže
 * jen tehdy, když na jeho cestu neukazuje žádný jiný živý řádek. Klíč
 * v úložišti je obsahově adresovaný, takže dvě různá `assets.id` téhož projektu
 * na jednu cestu mířit MŮŽOU (unikátní index platí jen `WHERE purged_at IS
 * NULL`, takže po uklizení řádku smí vzniknout nový se stejným obsahem).
 */
export async function cleanupAssetsHandler(deps: CleanupAssetsDeps): Promise<CleanupAssetsResult> {
  const workspaceIds = await deps.listWorkspaces();
  const days = deps.purgeAfterDays ?? PURGE_AFTER_DAYS;
  const failures: Array<{ workspaceId: string; error: string }> = [];
  let purged = 0;

  for (const workspaceId of workspaceIds) {
    const ctx = createSystemContext(workspaceId, 'content.cleanup_assets');
    try {
      const candidates = await withWorkspace(ctx, (tx) =>
        listPurgeCandidates(tx, ctx, days, BATCH_PER_WORKSPACE),
      );
      for (const asset of candidates) {
        await purgeAsset({ ctx }, asset);
        purged += 1;
      }
    } catch (error) {
      failures.push({ workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Úklid assetů neprošel u ${failures.length} z ${workspaceIds.length} projektů: ` +
        failures.map((f) => `${f.workspaceId} (${f.error})`).join('; '),
    );
  }
  return { workspaces: workspaceIds.length, purged };
}

/**
 * Kompoziční kořen.
 *
 * `listWorkspaceIds()` bez nastavené `DATABASE_URL_MAINTENANCE` vyhodí výjimku
 * s vysvětlením, takže tik skončí v chybě a NEPŘESKOČÍ se tiše. Je to táž
 * cesta, jakou chybějící roli hlásí plánovač kampaní i dispečer retence.
 * U úklidu je tichý přeskok obzvlášť zrádný: nic se nesmaže, nic nespadne
 * a místo na disku roste, dokud se svazek nezaplní.
 */
export function systemCleanupAssetsDeps(): CleanupAssetsDeps {
  return { listWorkspaces: () => listWorkspaceIds() };
}
