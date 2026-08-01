import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { WorkspaceContext } from '../identity/types';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace } from '../tx';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { seedAssetForCoreTests } from './test-fixtures';
import { ASSET_REF_TYPES, syncAssetReferences } from './asset-references';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const countOf = async (ctx: WorkspaceContext, assetId: string) =>
  withWorkspace(ctx, async (tx) => {
    const [row] = await tx
      .select({ n: schema.assets.referenceCount })
      .from(schema.assets)
      .where(eq(schema.assets.id, assetId));
    return row?.n ?? null;
  });

describe('asset references', () => {
  it('keeps the closed registry of ref types', () => {
    expect(ASSET_REF_TYPES).toContain('template');
    for (const value of ASSET_REF_TYPES) expect(value).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
  });

  it('raises and lowers reference_count together with the rows', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);
    const templateId = crypto.randomUUID();

    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.ctx, { refType: 'template', refId: templateId }, [asset.id]),
    );
    expect(await countOf(ws.ctx, asset.id)).toBe(1);

    // Druhé srovnání na tutéž množinu nesmí počet zvednout podruhé.
    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.ctx, { refType: 'template', refId: templateId }, [asset.id]),
    );
    expect(await countOf(ws.ctx, asset.id)).toBe(1);

    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.ctx, { refType: 'template', refId: templateId }, []),
    );
    expect(await countOf(ws.ctx, asset.id)).toBe(0);
    const left = await withWorkspace(ws.ctx, (tx) =>
      tx
        .select()
        .from(schema.assetReferences)
        .where(
          and(
            eq(schema.assetReferences.refType, 'template'),
            eq(schema.assetReferences.refId, templateId),
          ),
        ),
    );
    expect(left).toEqual([]);
  });

  it('counts the same asset once per owner, so two templates give two', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);
    for (const refId of [crypto.randomUUID(), crypto.randomUUID()]) {
      await withWorkspace(ws.ctx, (tx) =>
        syncAssetReferences(tx, ws.ctx, { refType: 'template', refId }, [asset.id]),
      );
    }
    expect(await countOf(ws.ctx, asset.id)).toBe(2);
  });

  it('ignores an asset id that does not belong to the workspace', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const other = await seedWorkspaceForCoreTests();
    const foreign = await seedAssetForCoreTests(other);
    const result = await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.ctx, { refType: 'template', refId: crypto.randomUUID() }, [
        foreign.id,
      ]),
    );
    expect(result.added).toBe(0);
    expect(await countOf(other.ctx, foreign.id)).toBe(0);
  });

  it('never lets the count go below zero', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);
    const refId = crypto.randomUUID();
    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.ctx, { refType: 'template', refId }, [asset.id]),
    );
    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.ctx, { refType: 'template', refId }, []),
    );
    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.ctx, { refType: 'template', refId }, []),
    );
    expect(await countOf(ws.ctx, asset.id)).toBe(0);
  });
});
