import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Document } from '@mlain/emails/document/types';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace } from '../tx';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { createTemplateRow, findTemplateById } from './repository';
import { createVersion, listVersions, pruneVersions, restoreVersion } from './versions';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const design = (name: string, schemaVersion = 1) =>
  ({
    schemaVersion,
    meta: { name, previewText: '', language: 'cs' },
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
  }) as unknown as Document;

const seedTemplate = async (name = 'A') => {
  const ws = await seedWorkspaceForCoreTests();
  const template = await withWorkspace(ws.ctx, (tx) =>
    createTemplateRow(tx, ws.ctx, {
      name,
      kind: 'campaign',
      design: design(name),
      usedFields: [],
    }),
  );
  return { ws, template };
};

describe('template versions', () => {
  it('numbers versions from one', async () => {
    const { ws, template } = await seedTemplate();
    const first = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual' }),
    );
    expect(first.version).toBe(1);
    const second = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual', design: design('B') }),
    );
    expect(second.version).toBe(2);
  });

  it('creates at most one version for two saves with the same content', async () => {
    const { ws, template } = await seedTemplate();
    await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual' }),
    );
    await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual' }),
    );
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.ctx, template.id));
    expect(history).toHaveLength(1);
  });

  it('restores forward and leaves the old version untouched', async () => {
    const { ws, template } = await seedTemplate();
    const v1 = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual' }),
    );
    await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual', design: design('B') }),
    );
    const restored = await withWorkspace(ws.ctx, (tx) =>
      restoreVersion(tx, ws.ctx, template.id, v1.version, ['contact.attr.city']),
    );
    expect(restored.version).toBe(3);
    expect(restored.reason).toBe('restore');
    expect(restored.label).toBe('Obnoveno z verze 1');
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.ctx, template.id));
    expect(history.find((v) => v.version === 1)?.design).toEqual(design('A'));
  });

  it('restore rewrites schema_version and used_fields, not just the design', async () => {
    const { ws, template } = await seedTemplate();
    // Verze uložená před migrací dokumentu má nižší schemaVersion.
    const old = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual', design: design('stará', 1) }),
    );
    await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual', design: design('nová', 2) }),
    );
    await withWorkspace(ws.ctx, (tx) =>
      tx
        .update(schema.templates)
        .set({ schemaVersion: 2, usedFields: ['contact.attr.stare'] })
        .where(eq(schema.templates.id, template.id)),
    );

    await withWorkspace(ws.ctx, (tx) =>
      restoreVersion(tx, ws.ctx, template.id, old.version, ['contact.attr.nove']),
    );

    const row = await withWorkspace(ws.ctx, (tx) => findTemplateById(tx, ws.ctx, template.id));
    // Bez tohohle by sloupec hlásil novou verzi u starého dokumentu,
    // loadDocument by migraci nespustil a validátor by jel staré schéma.
    expect(row!.schemaVersion).toBe(1);
    expect(row!.usedFields).toEqual(['contact.attr.nove']);
  });

  it('never prunes a pinned version, even past the retention window', async () => {
    const { ws, template } = await seedTemplate();
    const pinned = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'pre_send', pinned: true }),
    );
    await withWorkspace(ws.ctx, (tx) =>
      tx
        .update(schema.templateVersions)
        .set({ createdAt: sql`now() - interval '400 days'` })
        .where(eq(schema.templateVersions.id, pinned.id)),
    );
    await withWorkspace(ws.ctx, (tx) =>
      pruneVersions(tx, ws.ctx, { retentionDays: 180, maxUnpinned: 50 }),
    );
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.ctx, template.id));
    expect(history).toHaveLength(1);
  });

  it('never prunes the version the template currently points at', async () => {
    const { ws, template } = await seedTemplate();
    const current = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual' }),
    );
    await withWorkspace(ws.ctx, (tx) =>
      tx
        .update(schema.templateVersions)
        .set({ createdAt: sql`now() - interval '400 days'` })
        .where(eq(schema.templateVersions.id, current.id)),
    );

    await withWorkspace(ws.ctx, (tx) =>
      pruneVersions(tx, ws.ctx, { retentionDays: 180, maxUnpinned: 0 }),
    );

    // Cizí klíč má ON DELETE SET NULL, takže smazání by nikde nespadlo:
    // šablona by jen tiše ztratila ukazatel a API by vracelo current_version: null.
    const row = await withWorkspace(ws.ctx, (tx) => findTemplateById(tx, ws.ctx, template.id));
    expect(row!.currentVersionId).toBe(current.id);
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.ctx, template.id));
    expect(history.map((v) => v.id)).toContain(current.id);
  });

  it('keeps at most the configured number of unpinned versions', async () => {
    const { ws, template } = await seedTemplate();
    for (let i = 0; i < 6; i += 1) {
      await withWorkspace(ws.ctx, (tx) =>
        createVersion(tx, ws.ctx, template.id, { reason: 'manual', design: design(`v${i}`) }),
      );
    }
    await withWorkspace(ws.ctx, (tx) =>
      pruneVersions(tx, ws.ctx, { retentionDays: 180, maxUnpinned: 3 }),
    );
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.ctx, template.id));
    // Tři nejnovější nepřipnuté plus aktuální, kterou retence nesmí vzít.
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.map((v) => v.id)).toContain(
      (await withWorkspace(ws.ctx, (tx) => findTemplateById(tx, ws.ctx, template.id)))!
        .currentVersionId,
    );
  });

  it('does not see versions from another workspace', async () => {
    const { ws, template } = await seedTemplate();
    await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.ctx, template.id, { reason: 'manual' }),
    );
    const other = await seedWorkspaceForCoreTests();
    const seen = await withWorkspace(other.ctx, (tx) => listVersions(tx, other.ctx, template.id));
    expect(seen).toEqual([]);
  });
});
