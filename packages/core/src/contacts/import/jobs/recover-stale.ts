import { listStaleImports } from '../../../platform/maintenance-scan';
import { importLogger } from '../logging';

export type RecoverPayload = { workspaceId: string; importId: string; phase: 'run' };

/**
 * Job má retryLimit = 0, takže obnovu řídí importér sám. Jediný signál živosti
 * je `imports.updated_at`, které zapisuje KAŽDÁ checkpointová transakce.
 *
 * OPRAVA ROZHODNUTÍ R18. Sken jde napříč projekty a běžel pod `withoutContext`,
 * tedy pod `mlain_app` BEZ nastaveného `mlain.workspace_id`. `imports` má
 * politiku `ws_isolation`, takže porovnání s NULL vyloučilo všechny řádky.
 * Ověřeno spuštěním proti běžící databázi: `mlain_migrator` vidí 3 importy,
 * `mlain_app` bez kontextu 0.
 *
 * Rozhodnutí R18 s tím počítalo a čekalo na politiku `system_bypass`, která
 * nikdy nevznikla. Dodává ji migrace 0024, a to v tom tvaru, jaký v repozitáři
 * pro systémové skeny platí: role `mlain_maintenance`, jmenovitá politika
 * a SLOUPCOVÝ grant, takže tahle role z `imports` přečte jen identifikaci
 * a řídicí sloupce. `filename` ani `error_summary`, do kterého se ukládají
 * ukázky hodnot z nahraného CSV, jí databáze nevydá.
 *
 * DOPAD BYL TRVALÝ, ne jen kosmetický. Zabitý worker nechá řádek ve stavu
 * `importing`. Blokuje přitom stav řádku, ne klíč fronty: klíč je ID importu,
 * takže zamyká jen sám sebe, ale `confirmImport` odmítne další import, dokud
 * v projektu takový řádek leží (`import_already_running`). Bez funkčního skenu
 * tedy projekt zůstal bez importů napořád.
 *
 * Sken sám i strážce, který ticho odliší od prázdna, leží v
 * `platform/maintenance-scan.ts`. Je to schválně jediný soubor: výjimka
 * z izolace projektů je hlavní bezpečnostní vlastnost produktu a musí jít
 * přečíst celá na jedné obrazovce.
 */
export async function recoverStaleImports(
  opts: { staleMinutes: number },
  enqueue: (payload: RecoverPayload) => Promise<void>,
): Promise<number> {
  const rows = await listStaleImports(opts.staleMinutes);
  for (const row of rows) {
    await enqueue({ workspaceId: row.workspaceId, importId: row.importId, phase: 'run' });
  }
  importLogger().info({ recovered: rows.length }, 'stale imports requeued');
  return rows.length;
}
