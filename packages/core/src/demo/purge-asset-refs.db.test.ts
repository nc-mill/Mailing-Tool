import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace } from '../tx';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { seedAssetForCoreTests } from '../templates/test-fixtures';
import { syncAssetReferences } from '../templates/asset-references';
import { assetUsage } from '../assets/repository';
import { emptyDemoManifest } from './manifest';
import { purgeDemoData } from './purge';

/**
 * ODKAZY NA OBRÁZKY PO ÚKLIDU UKÁZKOVÝCH DAT.
 *
 * `purgeDemoData` maže ukázkové šablony a kampaně tvrdým `DELETE`, tedy mimo
 * `deleteTemplate` a `softDeleteCampaign`, které odkazy ruší samy. Protože
 * `asset_references.ref_id` je polymorfní a nemůže mít cizí klíč, nic se
 * nemazalo kaskádou a po úklidu zůstávaly odkazy na obrázky, jejichž vlastník
 * už neexistuje.
 *
 * Není to kosmetika: `listPurgeCandidates` bere jen assety s
 * `reference_count = 0`, takže osiřelá reference zablokuje fyzický úklid
 * obrázku NATRVALO.
 *
 * VERZE ŠABLONY JSOU V TESTU SCHVÁLNĚ. Visí na `templates` cizím klíčem
 * `ON DELETE CASCADE`, takže po smazání šablony se už nedá zjistit, které
 * existovaly. Kdo by je nedohledal PŘED mazáním, vyrobí odkazy, které nikdo
 * nikdy nespáruje s vlastníkem.
 */

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('úklid ukázkových dat a odkazy na obrázky', () => {
  it('zruší odkazy šablony, její verze i kampaně a srovná čítač', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);

    const { templateId, versionId, campaignId } = await withWorkspace(ws.ctx, async (tx) => {
      const { rows: templateRows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO templates (workspace_id, name, kind, design, design_hash)
        VALUES (${ws.workspaceId}::uuid, ${'Ukázková šablona'}, 'campaign', '{}'::jsonb,
                decode(repeat('bb', 32), 'hex'))
        RETURNING id
      `);
      const tId = templateRows[0]!.id;

      const { rows: versionRows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO template_versions
          (workspace_id, template_id, version, schema_version, design, design_hash)
        VALUES (${ws.workspaceId}::uuid, ${tId}::uuid, 1, 1, '{}'::jsonb,
                decode(repeat('bb', 32), 'hex'))
        RETURNING id
      `);
      const vId = versionRows[0]!.id;

      const { rows: campaignRows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO campaigns (workspace_id, name, status)
        VALUES (${ws.workspaceId}::uuid, ${'Ukázková kampaň'}, 'draft')
        RETURNING id
      `);
      const cId = campaignRows[0]!.id;

      await syncAssetReferences(tx, ws.ctx, { refType: 'template', refId: tId }, [asset.id]);
      await syncAssetReferences(tx, ws.ctx, { refType: 'template_version', refId: vId }, [
        asset.id,
      ]);
      await syncAssetReferences(tx, ws.ctx, { refType: 'campaign', refId: cId }, [asset.id]);

      const manifest = {
        ...emptyDemoManifest(new Date()),
        templateIds: [tId],
        campaignIds: [cId],
      };
      await tx.execute(sql`
        UPDATE workspaces
           SET settings = settings || jsonb_build_object('demoData', ${JSON.stringify(manifest)}::jsonb)
         WHERE id = ${ws.workspaceId}::uuid`);

      return { templateId: tId, versionId: vId, campaignId: cId };
    });

    expect(await pocet(ws.ctx, asset.id)).toBe(3);

    // Verze se v rozhraní musí pojmenovat svou šablonou. Dokud se nedohledávala,
    // stálo u obrázku „použito v:" a za tím nic.
    const pred = await withWorkspace(ws.ctx, (tx) => assetUsage(tx, ws.ctx, asset.id));
    expect(pred.find((u) => u.type === 'template_version')?.name).toBe('Ukázková šablona');

    const report = await withWorkspace(ws.ctx, (tx) =>
      purgeDemoData(tx, { workspaceId: ws.workspaceId }),
    );
    expect(report.deleted.templates, 'manifest se nenačetl, test by měřil prázdno').toBe(1);
    expect(report.deleted.campaigns).toBe(1);

    // Vlastníci jsou pryč, takže po nich nesmí zůstat ani jeden odkaz.
    const po = await withWorkspace(ws.ctx, (tx) => assetUsage(tx, ws.ctx, asset.id));
    expect(
      po,
      `po úklidu zůstaly odkazy ${JSON.stringify(po)}, obrázek už nepůjde nikdy uklidit`,
    ).toEqual([]);
    expect(await pocet(ws.ctx, asset.id)).toBe(0);

    // Kontrola, že test opravdu mazal to, co si myslí: vlastníci neexistují.
    const zbytky = await withWorkspace(ws.ctx, async (tx) => {
      const { rows } = await tx.execute<{ n: number }>(sql`
        SELECT (SELECT count(*) FROM templates WHERE id = ${templateId}::uuid)
             + (SELECT count(*) FROM template_versions WHERE id = ${versionId}::uuid)
             + (SELECT count(*) FROM campaigns WHERE id = ${campaignId}::uuid) AS n`);
      return Number(rows[0]!.n);
    });
    expect(zbytky).toBe(0);
  });

  /** Odkaz cizího vlastníka se rušit NESMÍ, jinak úklid sebere obrázek pod rukama. */
  it('nechá na pokoji odkazy, které do ukázkové sady nepatří', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);

    const { demoTemplateId, vlastniId } = await withWorkspace(ws.ctx, async (tx) => {
      const zaloz = async (name: string) => {
        const { rows } = await tx.execute<{ id: string }>(sql`
          INSERT INTO templates (workspace_id, name, kind, design, design_hash)
          VALUES (${ws.workspaceId}::uuid, ${name}, 'campaign', '{}'::jsonb,
                  decode(repeat('cc', 32), 'hex'))
          RETURNING id
        `);
        return rows[0]!.id;
      };
      const demo = await zaloz('Ukázková');
      const vlastni = await zaloz('Vlastní práce');
      await syncAssetReferences(tx, ws.ctx, { refType: 'template', refId: demo }, [asset.id]);
      await syncAssetReferences(tx, ws.ctx, { refType: 'template', refId: vlastni }, [asset.id]);

      const manifest = { ...emptyDemoManifest(new Date()), templateIds: [demo] };
      await tx.execute(sql`
        UPDATE workspaces
           SET settings = settings || jsonb_build_object('demoData', ${JSON.stringify(manifest)}::jsonb)
         WHERE id = ${ws.workspaceId}::uuid`);

      return { demoTemplateId: demo, vlastniId: vlastni };
    });

    expect(await pocet(ws.ctx, asset.id)).toBe(2);
    await withWorkspace(ws.ctx, (tx) => purgeDemoData(tx, { workspaceId: ws.workspaceId }));

    const po = await withWorkspace(ws.ctx, (tx) => assetUsage(tx, ws.ctx, asset.id));
    expect(po.map((u) => u.id)).toEqual([vlastniId]);
    expect(po[0]!.name, 'jméno vlastníka musí jít dohledat, jinak rozhraní ukáže prázdno').toBe(
      'Vlastní práce',
    );
    expect(await pocet(ws.ctx, asset.id)).toBe(1);
    expect(demoTemplateId).not.toBe(vlastniId);
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
