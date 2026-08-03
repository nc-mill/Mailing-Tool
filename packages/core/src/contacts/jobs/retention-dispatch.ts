import { createSystemContext } from '../../identity/context';
import { listWorkspaceIds } from '../../platform/maintenance-scan';
import { withWorkspace } from '../../tx';
import { enqueue } from './enqueue';
import { retentionOffsetSeconds } from './retention-offset';
import type { RetentionRunPayload } from './retention-run';

/**
 * Rozprostírající dispečer denní retence.
 *
 * PROČ VZNIKL. `registerQueues` plánuje KAŽDÝ cron s prázdným nákladem
 * (`boss.schedule(name, cron, {}, …)`), jenže retence běží nad JEDNÍM projektem:
 * bez `workspaceId` by `createSystemContext` dostal `undefined`, RLS by nepustila
 * ani řádek a běh by ohlásil úspěch, přestože by nesmazal nic. Obsluha proto
 * cronový tik odmítala výjimkou, což bylo správné jako pojistka a nedostatečné
 * jako řešení: DENNÍ RETENČNÍ BĚH NEMAZAL NIC, každou noc.
 *
 * TVAR JE OPSANÝ z `campaigns/jobs/system-deps.ts` a je závazný ve dvou taktech:
 *
 *   1. Sken pod rolí `mlain_maintenance` (`platform/maintenance-scan.ts`) vrátí
 *      IDENTIFIKÁTORY projektů, a nic víc.
 *   2. Všechna další práce běží pod `mlain_app` v systémovém kontextu jednoho
 *      projektu, takže na ni dopadá RLS stejně jako na požadavek z API.
 *
 * CO ROLI `mlain_maintenance` CHYBÍ: NIC. Dispečer potřebuje jedinou věc, totiž
 * `SELECT id FROM workspaces`, a tu jí migrace 0009 dala (`GRANT SELECT ON
 * workspaces` plus politika `maintenance_scan`). Vlastní retence pod tu roli
 * nesahá vůbec: sedm cílů z `RETENTION_TARGETS` leží v tabulkách s politikou
 * `ws_isolation` a maže je aplikační role v kontextu projektu. Výčet tabulek
 * v migraci 0009 je jmenovitý schválně a tenhle plán ho NEROZŠIŘUJE.
 *
 * JEDNA ÚLOHA NA PROJEKT, ne jedna přes všechny. Tři důvody, každý sám o sobě
 * rozhodující:
 *   - PÁD JEDNOHO PROJEKTU. V jedné úloze by výjimka nad projektem číslo 3
 *     zabila i projekty 4 až N a poznalo by se to podle jediné chybové úlohy.
 *     Takhle spadne jen ta jedna úloha a v `retention_runs` je vidět, které
 *     projekty doběhly.
 *   - EXPIRACE. Fronta má `expireInSeconds` 40 minut a jeden běh má vlastní
 *     tvrdý strop 30 minut (`RUN_TIMEOUT_MS`). Společná úloha přes sto projektů
 *     by ten strop překročila, pg-boss by ji ukončil uprostřed a při
 *     `retryLimit: 0` by ji nikdo nezopakoval.
 *   - SINGLETON KLÍČ. Registr fronty má `singletonKeyTemplate: '<workspace_id>'`,
 *     což u společné úlohy nedává smysl. Zařazení po projektech ho naplní.
 *
 * ROZPROSTŘENÍ V ČASE je požadavek z registru front („offset odvozený z hashe
 * workspace_id"), ne ozdoba: sto projektů zařazených v jednu sekundu znamená
 * sto souběžných mazacích dávek proti téže databázi ve chvíli, kdy se ještě
 * odesílá. Offset je DETERMINISTICKÝ, aby projekt měl svůj čas každou noc týž
 * a šlo podle něj hledat v logu.
 *
 * Sám výpočet offsetu bydlí v `retention-offset.ts`, tedy v souboru BEZ
 * přístupu k databázi, a je to věcný požadavek testu disciplíny izolace
 * (`identity/scope.test.ts`), ne organizační rozmar. Důvod je popsaný tam.
 */

export type RetentionDispatchDeps = {
  /** Výčet živých projektů napříč instalací. Pod rolí `mlain_maintenance`. */
  listWorkspaces(): Promise<string[]>;
  /** Zařazení jednoho běhu. Odděleno kvůli testu bez databáze. */
  enqueueRun(input: RetentionRunPayload & { startAfterSeconds: number }): Promise<void>;
  /** Šířka okna rozprostření. Test si ji nastavuje na nulu, aby byl deterministický. */
  spreadSeconds?: number;
};

export type RetentionDispatchResult = { workspaces: number; dispatched: number; failed: number };

/**
 * Cronový tik: rozešle retenci po projektech.
 *
 * NEZASTAVUJE SE NA PRVNÍ CHYBĚ. Kdyby se zastavil, jeden projekt s uzamčeným
 * řádkem nebo s vyčerpaným spojením by sebral retenci všem projektům za sebou.
 * Chyby se sesbírají, ostatní projekty se zařadí, a teprve pak úloha SPADNE se
 * seznamem projektů, které se zařadit nepovedlo. Tichý úspěch nad polovinou
 * instalace je u retence osobních údajů to nejhorší, co může nastat.
 */
export async function retentionDispatchHandler(
  deps: RetentionDispatchDeps,
): Promise<RetentionDispatchResult> {
  const workspaceIds = await deps.listWorkspaces();
  const failures: Array<{ workspaceId: string; error: string }> = [];
  let dispatched = 0;

  for (const workspaceId of workspaceIds) {
    try {
      await deps.enqueueRun({
        workspaceId,
        startAfterSeconds: retentionOffsetSeconds(workspaceId, deps.spreadSeconds),
      });
      dispatched += 1;
    } catch (error) {
      failures.push({ workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Dispečer retence nezařadil ${failures.length} z ${workspaceIds.length} projektů: ` +
        failures.map((f) => `${f.workspaceId} (${f.error})`).join('; '),
    );
  }

  return { workspaces: workspaceIds.length, dispatched, failed: 0 };
}

/**
 * Kompoziční kořen dispečera.
 *
 * `listWorkspaceIds()` bez nastavené `DATABASE_URL_MAINTENANCE` vyhodí výjimku
 * s vysvětlením, takže cronový tik skončí v chybě a NEPŘESKOČÍ se tiše. Je to
 * záměrně tatáž cesta, jakou hlásí chybějící roli plánovač kampaní.
 *
 * `singletonKey` je `workspaceId`, tedy to, co má registr fronty v
 * `singletonKeyTemplate`. Pozor na jeho dosah: fronty se zakládají s politikou
 * `standard`, u které pg-boss unikátní index nad `singleton_key` NEVYTVÁŘÍ,
 * takže klíč sám o sobě druhé zařazení nezakáže. Nevadí to a je to poctivější
 * než se na něj spoléhat: retence je idempotentní (maže podle stáří), takže
 * druhý běh téže noci jen zapíše do `retention_runs` řádek s nulou.
 */
export function systemRetentionDispatchDeps(): RetentionDispatchDeps {
  return {
    listWorkspaces: () => listWorkspaceIds(),
    enqueueRun: async ({ workspaceId, startAfterSeconds }) => {
      const ctx = createSystemContext(workspaceId, 'retention.run');
      await withWorkspace(ctx, (tx) =>
        enqueue(
          tx,
          'retention.run',
          { workspaceId },
          { singletonKey: workspaceId, startAfterSeconds },
        ),
      );
    },
  };
}
