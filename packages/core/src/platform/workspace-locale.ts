import { sql } from 'drizzle-orm';
import { withWorkspace, type Tx, type WorkspaceContext } from '../tx';

/**
 * Jazyk projektu, tedy ten, ve kterém se posílají systémové e-maily lidem,
 * jejichž vlastní jazyk neznáme.
 *
 * PROČ TO NENÍ `DEFAULT_LOCALE`. Ta proměnná je jazyk INSTALACE, takže
 * instalace s vícejazyčnými projekty posílala do anglického projektu české
 * e-maily. Kdykoli adresát nemá účet (pozvánka) nebo vůbec nemusí být
 * uživatelem produktu (ověření odesílací adresy ve zkušebním režimu), je
 * projekt to nejbližší, co o jazyce víme, a zve se nebo ověřuje se právě
 * do něj. `DEFAULT_LOCALE` zůstává jako pojistka u volajícího.
 *
 * Vrací `null`, ne výjimku, a je to schválně: e-mail, který se neodešle,
 * protože se nepovedlo přečíst jazyk, je horší než e-mail ve výchozím jazyce.
 */
export async function readWorkspaceLocale(ctx: WorkspaceContext): Promise<string | null> {
  return withWorkspace(ctx, (tx) => readWorkspaceLocaleTx(tx, ctx));
}

/** Táž věc uvnitř běžící transakce, pro volající, kteří už jednu drží. */
export async function readWorkspaceLocaleTx(tx: Tx, ctx: WorkspaceContext): Promise<string | null> {
  const { rows } = await tx.execute<{ locale: string }>(sql`
    SELECT locale FROM workspaces WHERE id = ${ctx.workspaceId}::uuid LIMIT 1
  `);
  return rows[0]?.locale ?? null;
}
