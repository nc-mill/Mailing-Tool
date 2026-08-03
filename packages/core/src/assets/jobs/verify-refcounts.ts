import { createSystemContext } from '../../identity/context';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { withWorkspace } from '../../tx';
import { refcountMismatches } from '../repository';

/**
 * Kontrola denormalizovaného `assets.reference_count`
 * (`content.verify_asset_refcounts`, cron 3:30).
 *
 * PROČ EXISTUJE. `reference_count` je denormalizace `asset_references` a drží
 * ji `syncAssetReferences` v transakci se zápisem dokumentu. Schéma to má
 * napsané výslovně, včetně toho, proč to nedělá trigger. Denormalizace se ale
 * dřív nebo později rozejde (pád mezi zápisy, ruční zásah do databáze, chyba
 * v budoucím volajícím) a je lepší se to dozvědět z logu než z hlášení
 * uživatele, kterému úklid smazal obrázek z odeslané kampaně.
 *
 * NEOPRAVUJE. Kdyby úloha nesoulad tiše dorovnala, ztratila by se informace,
 * že k němu došlo, a příčina by se nikdy nenašla. Sloupec je vstup mazacího
 * rozhodnutí; tichá oprava čísla, které rozhoduje o smazání souboru, je horší
 * než hlasitá nesrovnalost.
 *
 * ÚLOHA KVŮLI NESOULADU NESPADNE. Nesoulad je nález, ne selhání běhu; pád by
 * ho poslal do dead letter a při `retryLimit: 1` by se opakoval každou noc se
 * stejným výsledkem. Spadne jen tehdy, když se projekt nepodařilo zkontrolovat.
 */
export type VerifyRefcountsDeps = {
  listWorkspaces(): Promise<string[]>;
  /** Kam se hlásí nález. Odděleno kvůli testu bez loggeru. */
  report(finding: { workspaceId: string; assetId: string; stored: number; actual: number }): void;
};

export type VerifyRefcountsResult = { workspaces: number; mismatches: number };

export async function verifyRefcountsHandler(
  deps: VerifyRefcountsDeps,
): Promise<VerifyRefcountsResult> {
  const workspaceIds = await deps.listWorkspaces();
  const failures: Array<{ workspaceId: string; error: string }> = [];
  let mismatches = 0;

  for (const workspaceId of workspaceIds) {
    const ctx = createSystemContext(workspaceId, 'content.verify_asset_refcounts');
    try {
      const found = await withWorkspace(ctx, (tx) => refcountMismatches(tx, ctx));
      for (const row of found) {
        deps.report({ workspaceId, ...row });
        mismatches += 1;
      }
    } catch (error) {
      failures.push({ workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Kontrola počtu referencí neprošla u ${failures.length} z ${workspaceIds.length} projektů: ` +
        failures.map((f) => `${f.workspaceId} (${f.error})`).join('; '),
    );
  }
  return { workspaces: workspaceIds.length, mismatches };
}

export function systemVerifyRefcountsDeps(): VerifyRefcountsDeps {
  return {
    listWorkspaces: () => listWorkspaceIds(),
    report: (finding) => {
      // Bez loggeru instalace, protože ten se v `packages/core` skládá až
      // v procesu workeru. `console.error` je jediná konzolová metoda, kterou
      // lint pouští, a je to tady správně: rozpad denormalizace, která
      // rozhoduje o mazání souborů, není informace, ale nález k prošetření.
      console.error(
        `[content.verify_asset_refcounts] nesoulad reference_count: projekt=${finding.workspaceId} ` +
          `asset=${finding.assetId} v_databazi=${finding.stored} skutecnost=${finding.actual}`,
      );
    },
  };
}
