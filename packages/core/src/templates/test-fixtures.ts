import * as schema from '@mlain/db/schema';
import type { SeededWorkspace } from '../identity/test-helpers';
import { withWorkspace } from '../tx';

/**
 * Nahrávání assetů tenhle plán nevlastní (kapitola 40), ale reference na ně ano,
 * takže testy potřebují řádek v `assets`. Zakládá se přímo, protože jde
 * o testovací data, ne o produkční cestu nahrávání.
 */
export async function seedAssetForCoreTests(
  ws: SeededWorkspace,
): Promise<{ id: string; publicId: string }> {
  return withWorkspace(ws.ctx, async (tx) => {
    const publicId = Math.random().toString(36).slice(2).padEnd(22, 'x').slice(0, 22);
    const [row] = await tx
      .insert(schema.assets)
      .values({
        workspaceId: ws.workspaceId,
        publicId,
        originalFilename: 'banner.png',
        mimeType: 'image/png',
        sha256: Buffer.alloc(32, 7),
        byteSize: 1024,
        width: 1200,
        height: 600,
        frameCount: 1,
        altText: null,
        // Sloupec je NOT NULL bez výchozí hodnoty; plán ho v úkolu 35 vynechal
        // a vložení by skončilo na 23502.
        storageKey: `test/${publicId}.png`,
      })
      .returning({ id: schema.assets.id, publicId: schema.assets.publicId });
    return row!;
  });
}
