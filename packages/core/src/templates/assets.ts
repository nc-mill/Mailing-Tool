import { and, inArray, isNull } from 'drizzle-orm';
import type { AssetRef } from '@mlain/emails/compile/types';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

/**
 * Renderer je čistá funkce bez IO, takže data assetů si vyzvedne volající
 * a předá je v CompileContext (rozhodnutí D1).
 */
export async function loadAssetRefs(
  tx: Tx,
  ctx: WorkspaceContext,
  assetIds: string[],
): Promise<Record<string, AssetRef>> {
  if (assetIds.length === 0) return {};
  const rows = await tx
    .select()
    .from(schema.assets)
    .where(
      and(
        wsEq(ctx, schema.assets),
        inArray(schema.assets.id, assetIds),
        isNull(schema.assets.purgedAt),
      ),
    );
  if (rows.length === 0) return {};

  // POZOR: `assetIds` níž pochází z VÝSLEDKU předchozího dotazu, který workspace
  // filtruje, ne rovnou z requestu. Kdyby sem někdo napojil identifikátory
  // z requestu, izolace by stála jen na `wsEq` a druhá vrstva by zmizela.
  // Tenhle řádek se nepřepisuje.
  const variants = await tx
    .select()
    .from(schema.assetVariants)
    .where(
      and(
        wsEq(ctx, schema.assetVariants),
        inArray(
          schema.assetVariants.assetId,
          rows.map((row) => row.id),
        ),
      ),
    );

  const out: Record<string, AssetRef> = {};
  for (const row of rows) {
    out[row.id] = {
      id: row.id,
      publicId: row.publicId,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      altText: row.altText,
      animated: row.frameCount > 1,
      variants: variants
        .filter((variant) => variant.assetId === row.id)
        .map((variant) => ({
          variant: variant.variant,
          width: variant.width,
          height: variant.height,
        })),
    };
  }
  return out;
}

/** Všechna assetId, na která dokument odkazuje. Vstup pro loadAssetRefs i pro asset_references. */
export function assetIdsInDocument(design: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (
        ['assetId', 'darkVariantAssetId', 'backgroundImageAssetId'].includes(key) &&
        typeof value === 'string' &&
        value !== ''
      ) {
        ids.add(value);
      }
      visit(value);
    }
  };
  visit(design);
  return [...ids];
}
