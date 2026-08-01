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
