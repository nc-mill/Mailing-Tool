import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

/**
 * Uzavřený registr hodnot `asset_references.ref_type`. Databáze má na sloupci
 * jen regulární výraz `^[a-z][a-z0-9_]{0,31}$`, tedy překlep by prošel a vznikla
 * by reference, kterou už nikdo nikdy nenajde ani neuklidí.
 */
export const ASSET_REF_TYPES = [
  'template',
  'template_version',
  'brand_profile',
  'campaign',
] as const;
export type AssetRefType = (typeof ASSET_REF_TYPES)[number];

/**
 * Srovná množinu referencí jednoho vlastníka na `next` a o stejnou deltu upraví
 * `assets.reference_count`. Volá se VŽDY ve stejné transakci jako zápis dokumentu,
 * jinak by mezi zápisem a srovnáním mohl proběhnout úklid.
 *
 * Vrací počty, aby šlo v testu poznat rozdíl mezi „nic se nezměnilo"
 * a „funkce se neprovedla".
 */
export async function syncAssetReferences(
  tx: Tx,
  ctx: WorkspaceContext,
  owner: { refType: AssetRefType; refId: string },
  next: string[],
): Promise<{ added: number; removed: number }> {
  const wanted = new Set(next);

  const existing = await tx
    .select({ assetId: schema.assetReferences.assetId })
    .from(schema.assetReferences)
    .where(
      and(
        wsEq(ctx, schema.assetReferences),
        eq(schema.assetReferences.refType, owner.refType),
        eq(schema.assetReferences.refId, owner.refId),
      ),
    );
  const have = new Set(existing.map((row) => row.assetId));

  const toAdd = [...wanted].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wanted.has(id));

  let added = 0;

  if (toAdd.length > 0) {
    // Jen assety tohohle projektu. Cizí ani neexistující identifikátor
    // z dokumentu se do referencí nedostane a `reference_count` nezvedne.
    const own = await tx
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(and(wsEq(ctx, schema.assets), inArray(schema.assets.id, toAdd)));
    const ownIds = own.map((row) => row.id);
    if (ownIds.length > 0) {
      await tx
        .insert(schema.assetReferences)
        .values(
          ownIds.map((assetId) => ({
            workspaceId: ctx.workspaceId,
            assetId,
            refType: owner.refType,
            refId: owner.refId,
          })),
        )
        .onConflictDoNothing();
      await tx
        .update(schema.assets)
        .set({ referenceCount: sql`${schema.assets.referenceCount} + 1` })
        .where(and(wsEq(ctx, schema.assets), inArray(schema.assets.id, ownIds)));
    }
    added = ownIds.length;
  }

  if (toRemove.length > 0) {
    await tx
      .delete(schema.assetReferences)
      .where(
        and(
          wsEq(ctx, schema.assetReferences),
          eq(schema.assetReferences.refType, owner.refType),
          eq(schema.assetReferences.refId, owner.refId),
          inArray(schema.assetReferences.assetId, toRemove),
        ),
      );
    await tx
      .update(schema.assets)
      // GREATEST kvůli tomu, aby ani rozbitá historie nedala záporný počet:
      // sloupec je vstup úklidu a záporná hodnota by ho zablokovala napořád.
      .set({ referenceCount: sql`GREATEST(${schema.assets.referenceCount} - 1, 0)` })
      .where(and(wsEq(ctx, schema.assets), inArray(schema.assets.id, toRemove)));
  }

  return { added, removed: toRemove.length };
}

/**
 * Zrušení VŠECH odkazů několika vlastníků najednou, i těch, které vzniknou
 * kaskádou (verze pod tvrdě smazanou šablonou). `syncAssetReferences` na to
 * nestačí: bere jednoho vlastníka a druhá strana, tedy `template_versions`,
 * po `DELETE FROM templates` už neexistuje, takže by nešlo ani zjistit, čí
 * odkazy se mají zrušit.
 *
 * PROČ TO VŮBEC MUSÍ EXISTOVAT. `asset_references.ref_id` je polymorfní,
 * ukazuje střídavě na šablonu, na verzi šablony, na kampaň a na profil značky,
 * takže na něm NEMŮŽE být cizí klíč a databáze osiřelou referenci nesebere.
 * Integrita je čistě aplikační, a tady je poslední místo, kde se dá udržet.
 *
 * NÁSLEDEK VYNECHÁNÍ NENÍ KOSMETICKÝ. `listPurgeCandidates` bere jen assety
 * s `reference_count = 0`, takže osiřelá reference zablokuje fyzický úklid
 * obrázku NATRVALO a jeho soubor v úložišti nikdo nikdy nesmaže. Uživateli se
 * navíc v knihovně ukáže „použito v:" a za tím prázdno, protože `assetUsage`
 * jméno smazaného vlastníka nedohledá.
 *
 * `GREATEST(... , 0)` ze stejného důvodu jako výš: `reference_count` je vstup
 * úklidu a záporná hodnota by ho zablokovala napořád.
 *
 * Vrací počet zrušených odkazů, aby v testu šlo poznat rozdíl mezi „nebylo co
 * rušit" a „funkce se neprovedla".
 */
export async function clearAssetReferences(
  tx: Tx,
  workspaceId: string,
  owners: ReadonlyArray<{ refType: AssetRefType; refIds: readonly string[] }>,
): Promise<number> {
  const conditions = owners
    .filter((owner) => owner.refIds.length > 0)
    // sql.param() je u seznamů povinné. Holé pole se rozloží na $1, $2, $3
    // a dotaz spadne na 42809 op ANY/ALL (array) requires array on right side.
    .map(
      (owner) =>
        sql`(ref_type = ${owner.refType} AND ref_id = ANY(${sql.param([...owner.refIds])}))`,
    );
  if (conditions.length === 0) return 0;

  // Data měnící CTE Postgres provede vždy a celé, i když z něj hlavní dotaz
  // nečte. `bumped` se proto nikde nečte a přesto se srovnají počty.
  const { rows } = await tx.execute<{ removed: number }>(sql`
    WITH removed AS (
      DELETE FROM asset_references
       WHERE workspace_id = ${workspaceId}::uuid
         AND (${sql.join(conditions, sql` OR `)})
      RETURNING asset_id
    ), counted AS (
      SELECT asset_id, count(*)::int AS n FROM removed GROUP BY asset_id
    ), bumped AS (
      UPDATE assets a
         SET reference_count = GREATEST(a.reference_count - c.n, 0)
        FROM counted c
       WHERE a.id = c.asset_id AND a.workspace_id = ${workspaceId}::uuid
      RETURNING a.id
    )
    SELECT (SELECT count(*) FROM removed)::int AS removed
  `);
  return Number(rows[0]?.removed ?? 0);
}
