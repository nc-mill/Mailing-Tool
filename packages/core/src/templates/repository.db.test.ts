import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Document } from '@mlain/emails/document/types';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, pgErrorCode, withWorkspace } from '../tx';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import {
  createTemplateRow,
  findTemplateById,
  listTemplates,
  setValidationState,
  softDeleteTemplate,
  updateTemplateDesign,
} from './repository';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const design = {
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {
    contentWidth: 600,
    canvasBackground: 'surface.canvas',
    contentBackground: 'surface.content',
    colors: {},
    fonts: { heading: 'system', body: 'system' },
    typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 },
    radius: 6,
    darkMode: { strategy: 'auto', colors: {} },
  },
  blocks: [],
} as unknown as Document;

describe('template repository', () => {
  it('creates a row scoped to the workspace', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'První', kind: 'campaign', design, usedFields: [] }),
    );
    expect(created.id).toBeTypeOf('string');
    const found = await withWorkspace(a.ctx, (tx) => findTemplateById(tx, a.ctx, created.id));
    expect(found?.name).toBe('První');
  });

  it('never returns a template from another workspace', async () => {
    const a = await seedWorkspaceForCoreTests();
    const b = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    // Dvě nezávislé vrstvy naráz: RLS neuvidí cizí řádek ani bez podmínky ve WHERE,
    // a podmínka ve WHERE by ho nevrátila ani bez RLS.
    const foreign = await withWorkspace(b.ctx, (tx) => findTemplateById(tx, b.ctx, created.id));
    expect(foreign).toBeUndefined();
    const raw = await withWorkspace(b.ctx, (tx) =>
      tx.select().from(schema.templates).where(eq(schema.templates.id, created.id)),
    );
    expect(raw, 'kdyby tu byl řádek, drží izolaci jen podmínka ve WHERE a RLS nedělá nic').toEqual(
      [],
    );
  });

  it('stores used fields on creation, so impact analysis sees a brand new template', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, {
        name: 'S poli',
        kind: 'campaign',
        design,
        usedFields: ['contact.attr.city'],
      }),
    );
    expect(created.usedFields).toEqual(['contact.attr.city']);
  });

  it('stores the design hash so an unchanged save is detectable', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    const again = await withWorkspace(a.ctx, (tx) =>
      updateTemplateDesign(tx, a.ctx, created.id, design, []),
    );
    expect(again.changed).toBe(false);
    const changed = await withWorkspace(a.ctx, (tx) =>
      updateTemplateDesign(
        tx,
        a.ctx,
        created.id,
        { ...design, meta: { ...design.meta, name: 'Jiné' } },
        [],
      ),
    );
    expect(changed.changed).toBe(true);
  });

  it('rejects an expected hash that is not thirty two bytes', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    await expect(
      withWorkspace(a.ctx, (tx) =>
        updateTemplateDesign(tx, a.ctx, created.id, design, [], Buffer.alloc(3)),
      ),
    ).rejects.toThrow('precondition_malformed');
  });

  it('hides soft deleted templates from the list', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    await withWorkspace(a.ctx, (tx) => softDeleteTemplate(tx, a.ctx, created.id));
    const list = await withWorkspace(a.ctx, (tx) => listTemplates(tx, a.ctx, { limit: 20 }));
    expect(list.items).toHaveLength(0);
  });

  it('rejects a duplicate name in the same workspace with the sqlstate on the cause', async () => {
    const a = await seedWorkspaceForCoreTests();
    await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    // ODCHYLKA OD PLÁNU. Plán chybu chytal UVNITŘ callbacku a vracel ji jako
    // hodnotu. Tím se transakce nechala doběhnout do COMMITu, jenže po 23505
    // je transakce v Postgresu ve stavu „aborted" a COMMIT skončí na 25P02.
    // Test tedy měřil 25P02 místo 23505, tedy chybu obálky, ne kolizi jména.
    // Ověřeno spuštěním: `expected '25P02' to be '23505'`.
    const error = await withWorkspace(a.ctx, async (tx) => {
      await createTemplateRow(tx, a.ctx, {
        name: 'a',
        kind: 'campaign',
        design,
        usedFields: [],
      });
      return null;
    }).catch((caught: unknown) => caught);
    // Tenhle výraz je celý smysl testu: `error.code` je undefined, kód je na cause.
    expect((error as { code?: unknown }).code).toBeUndefined();
    expect(pgErrorCode(error)).toBe('23505');
  });

  it('pages by the pair updated_at and id, so revalidation cannot reshuffle the list', async () => {
    const a = await seedWorkspaceForCoreTests();
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C', 'D']) {
      const row = await withWorkspace(a.ctx, (tx) =>
        createTemplateRow(tx, a.ctx, { name, kind: 'campaign', design, usedFields: [] }),
      );
      ids.push(row.id);
    }
    // Hromadná převalidace posune updated_at u všech řádků na tutéž hodnotu.
    await withWorkspace(a.ctx, async (tx) => {
      for (const id of ids) await setValidationState(tx, a.ctx, id, 'valid', []);
    });
    const first = await withWorkspace(a.ctx, (tx) => listTemplates(tx, a.ctx, { limit: 2 }));
    expect(first.items).toHaveLength(2);
    const second = await withWorkspace(a.ctx, (tx) =>
      listTemplates(tx, a.ctx, { limit: 2, cursor: first.nextCursor! }),
    );
    const seen = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(seen).size, 'shodné updated_at nesmí řádek zdvojit ani přeskočit').toBe(
      seen.length,
    );
  });
});
