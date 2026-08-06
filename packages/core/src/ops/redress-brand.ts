import { sql } from 'drizzle-orm';
import { findDefaultBrandProfile } from '../brand/repo/profiles.repo';
import { getFieldCatalog } from '../contacts/fields/catalog';
import { createWorkspaceContext } from '../identity/context';
import { redressTemplatesToBrand } from '../templates/redress';
import { withWorkspace } from '../tx';
import { withAdminTx } from './db';

/**
 * JEDNORÁZOVÉ PŘEVLEČENÍ ULOŽENÝCH E-MAILŮ DO BAREV ZNAČKY.
 *
 * PROČ TO NENÍ MIGRACE. Nová hodnota motivu se v SQL spočítat nedá:
 * `brandToTheme` míchá odstíny, vybírá barvu textu podle kontrastu WCAG
 * a ztmavuje odkaz iterativně, dokud kontrast nestačí. Druhá kopie té
 * matematiky v PL/pgSQL by se tiše rozešla s tou v TypeScriptu.
 *
 * K tomu `templates.design_hash` je SHA-256 nad KANONICKOU serializací
 * (klíče lexikograficky), kdežto Postgres `jsonb` řadí klíče podle délky.
 * Naměřeno na skutečných řádcích: `sha256(design::text)` se s uloženým otiskem
 * neshoduje ani u jednoho. Migrace by tedy přepsala dokument a nechala u něj
 * otisk, který ho nepopisuje, a stav validace by zvětral taky, protože kontrast
 * se počítá z motivu.
 *
 * Pouští se proto kódem, který `brandToTheme`, `designHash` i validátor má,
 * a je to TATÁŽ funkce, kterou volá převlékání při uložení značky. Jedna
 * implementace, ne dvě, které se rozejdou.
 *
 * PRO KOHO TO JE. Instalace, která značku má a od upgradu ji znovu neuloží.
 * Té by jinak zůstaly staré barvy napořád, protože převlékání se spouští
 * uložením značky.
 *
 * `previous` je vždy `null`: co byla „předchozí značka", už nikdo neví. Pravidlo
 * se tím zúží na to nejopatrnější, tedy „doplň role, které dokument nemá nebo
 * ve kterých stojí výchozí hodnota, a písmo s rádiusem jen když jsou výchozí".
 * Ručně nastavené pozadí plátna ani vlastní písmo se nepřepíšou.
 *
 * IDEMPOTENTNÍ. Druhý běh nenajde co měnit, protože se u každého dokumentu
 * porovnává otisk a shodný dokument se přeskočí.
 */
export type RedressBrandReport = {
  workspaces: number;
  scanned: number;
  changed: number;
};

type WorkspaceRow = { id: string; name: string };

export async function redressAllWorkspacesToBrand(input: {
  /** Migrátorská role. Výpis projektů jde napříč projekty, tam RLS překáží. */
  adminUrl: string;
  onProgress?: (line: string) => void;
}): Promise<RedressBrandReport> {
  /*
   * Projekty BEZ ZNAČKY se vynechávají už dotazem, ne až uvnitř. Doplňovat jim
   * neutrální paletu by změnilo barvu tlačítek všem, kdo si žádnou značku
   * nenastavili, a o to nikdo nežádal.
   */
  const { rows } = await withAdminTx(input.adminUrl, (tx) =>
    tx.execute<WorkspaceRow>(sql`
      SELECT w.id, w.name
        FROM workspaces w
       WHERE w.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM brand_profiles b WHERE b.workspace_id = w.id)
       ORDER BY w.created_at
    `),
  );

  const report: RedressBrandReport = { workspaces: 0, scanned: 0, changed: 0 };

  for (const workspace of rows) {
    const ctx = await createWorkspaceContext({
      kind: 'system',
      job: 'brand_redress',
      workspaceId: workspace.id,
    });

    // Katalog polí se čte PŘED transakcí. Uvnitř by si otevřel druhé spojení
    // z poolu, zatímco to první drží zámek nad řádky šablon.
    const fields = await getFieldCatalog(ctx);
    const profile = await withWorkspace(ctx, (tx) => findDefaultBrandProfile(tx));
    if (profile === null) continue;

    const result = await withWorkspace(ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx, { previous: null, next: profile, fields }),
    );

    report.workspaces += 1;
    report.scanned += result.scanned;
    report.changed += result.changed;
    input.onProgress?.(`${workspace.name}: prošlo ${result.scanned}, převlečeno ${result.changed}`);
  }

  return report;
}
