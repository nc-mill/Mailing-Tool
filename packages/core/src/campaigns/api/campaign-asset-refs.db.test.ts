import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { eq } from 'drizzle-orm';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import { seedAssetForCoreTests } from '../../templates/test-fixtures';
import { syncAssetReferences } from '../../templates/asset-references';
import { assetUsage } from '../../assets/repository';
import { softDeleteCampaign } from './service';

/**
 * ODKAZY NA OBRÁZKY PO SMAZANÉ KAMPANI.
 *
 * `asset_references` nemá cizí klíč na `campaigns` ani `templates` a mít ho
 * nemůže: `ref_id` je polymorfní. Nic se tedy nemaže kaskádou a odkazy musí
 * rušit ten, kdo maže vlastníka. U knihovní šablony to `templates/service.ts`
 * dělá; u kampaně se to do 7. 8. 2026 nedělo, takže knihovna médií hlásila
 * u obrázku použití v kampani, kterou uživatel nevidí, a **nešlo smazat
 * obrázek, který už nikdo nepoužívá**.
 *
 * Test kontroluje obě strany té vazby, protože každá se dá rozbít zvlášť:
 * samotné řádky odkazů i denormalizovaný čítač `assets.reference_count`.
 */

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('smazání kampaně a odkazy na obrázky', () => {
  it('zruší odkazy kampaně i její pracovní kopie a srovná čítač', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);

    const { campaignId, workingCopyId } = await withWorkspace(ws.ctx, async (tx) => {
      // Pracovní kopie je řádek `templates` s `kind = 'system'`, na který míří
      // `campaigns.template_id`. Uživatel ji ve výpisu šablon nikdy neuvidí.
      const { rows: templateRows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO templates (workspace_id, name, kind, design, design_hash)
        VALUES (${ws.workspaceId}::uuid, ${'Pracovní kopie'}, 'system', '{}'::jsonb,
                decode(repeat('aa', 32), 'hex'))
        RETURNING id
      `);
      const templateId = templateRows[0]!.id;

      const { rows: campaignRows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO campaigns (workspace_id, name, template_id, status)
        VALUES (${ws.workspaceId}::uuid, ${'Kampaň s obrázkem'}, ${templateId}::uuid, 'draft')
        RETURNING id
      `);
      const cId = campaignRows[0]!.id;

      await syncAssetReferences(tx, ws.ctx, { refType: 'campaign', refId: cId }, [asset.id]);
      await syncAssetReferences(tx, ws.ctx, { refType: 'template', refId: templateId }, [asset.id]);
      return { campaignId: cId, workingCopyId: templateId };
    });

    // Výchozí stav: obrázek se používá dvakrát a knihovna to ukazuje.
    expect(await pocet(ws.ctx, asset.id)).toBe(2);
    const pred = await withWorkspace(ws.ctx, (tx) => assetUsage(tx, ws.ctx, asset.id));
    expect(pred).toHaveLength(2);

    const result = await softDeleteCampaign(ws.ctx, campaignId);
    expect(result.deleted).toBe(true);

    // Pracovní kopie odešla s kampaní, to je dosavadní chování a musí platit dál.
    const smazanaKopie = await withWorkspace(ws.ctx, async (tx) => {
      const [row] = await tx
        .select({ deletedAt: schema.templates.deletedAt })
        .from(schema.templates)
        .where(eq(schema.templates.id, workingCopyId));
      return row?.deletedAt ?? null;
    });
    expect(smazanaKopie).not.toBeNull();

    // A tohle je ta opravovaná část: po kampani ani po její pracovní kopii
    // nesmí zůstat odkaz, jinak obrázek nejde smazat kvůli použití, které
    // uživatel nikde nevidí.
    const po = await withWorkspace(ws.ctx, (tx) => assetUsage(tx, ws.ctx, asset.id));
    expect(po, 'po smazané kampani zůstalo použití, které uživatel nevidí').toEqual([]);
    expect(await pocet(ws.ctx, asset.id)).toBe(0);
  });

  /**
   * Odkazy jiného vlastníka se rušit NESMÍ. Kdyby `syncAssetReferences`
   * dostala špatný rozsah, spadl by čítač i u obrázku, který dál někdo
   * používá, a úklid by ho pak mohl sebrat pod rukama.
   */
  it('nechá na pokoji odkazy, které patří jiné kampani', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);

    const { mazana, zustava } = await withWorkspace(ws.ctx, async (tx) => {
      const zaloz = async (name: string) => {
        const { rows } = await tx.execute<{ id: string }>(sql`
          INSERT INTO campaigns (workspace_id, name, status)
          VALUES (${ws.workspaceId}::uuid, ${name}, 'draft')
          RETURNING id
        `);
        return rows[0]!.id;
      };
      const a = await zaloz('Mazaná');
      const b = await zaloz('Zůstává');
      await syncAssetReferences(tx, ws.ctx, { refType: 'campaign', refId: a }, [asset.id]);
      await syncAssetReferences(tx, ws.ctx, { refType: 'campaign', refId: b }, [asset.id]);
      return { mazana: a, zustava: b };
    });

    expect(await pocet(ws.ctx, asset.id)).toBe(2);
    await softDeleteCampaign(ws.ctx, mazana);

    const po = await withWorkspace(ws.ctx, (tx) => assetUsage(tx, ws.ctx, asset.id));
    expect(po.map((u) => u.id)).toEqual([zustava]);
    expect(await pocet(ws.ctx, asset.id)).toBe(1);
  });
});

/** Denormalizovaný čítač na assetu. Musí sedět s počtem řádků odkazů. */
async function pocet(ctx: Parameters<typeof withWorkspace>[0], assetId: string): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const [row] = await tx
      .select({ n: schema.assets.referenceCount })
      .from(schema.assets)
      .where(eq(schema.assets.id, assetId));
    return row?.n ?? -1;
  });
}
