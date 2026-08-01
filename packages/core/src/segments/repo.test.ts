import { describe, expect, it, vi } from 'vitest';
import { compileAudienceToSql } from './repo';
import type { SegmentAst } from './ast';
import { segmentErrorCode } from './errors';
import type { WorkspaceContext } from '../identity/types';

vi.mock('./references', () => ({
  resolveReferences: async (_ctx: unknown, ast: SegmentAst) => ({
    fieldClasses: { city: 'text' },
    segmentKinds: {
      '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60bb': { kind: 'static' },
    },
    archivedFields: [],
    unindexedFields: [],
    _ast: ast,
  }),
}));

const ctx = {
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6001',
  actor: { type: 'system', job: 'test' },
} as unknown as WorkspaceContext;

const asOf = new Date('2026-07-31T10:00:00Z');
const ast: SegmentAst = {
  version: 1,
  root: {
    type: 'group',
    op: 'and',
    children: [
      {
        type: 'condition',
        field: { kind: 'attribute', key: 'city' },
        operator: 'eq',
        value: 'Brno',
      },
    ],
  },
};

describe('compileAudienceToSql', () => {
  it('rejects an empty audience', async () => {
    const caught = await compileAudienceToSql(
      ctx,
      {},
      { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' },
    ).catch((e: unknown) => e);
    expect(segmentErrorCode(caught)).toBe('audience_empty');
  });

  it('returns a select with no order, limit or semicolon', async () => {
    const out = await compileAudienceToSql(
      ctx,
      { ast },
      { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' },
    );
    expect(out.sql.startsWith('SELECT a.id AS contact_id')).toBe(true);
    expect(out.sql).not.toMatch(/\border by\b|\blimit\b|\boffset\b/i);
    expect(out.sql).not.toContain(';');
  });

  it('is byte identical for the same asOf and ast', async () => {
    const opts = { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' };
    const one = await compileAudienceToSql(ctx, { ast }, opts);
    const two = await compileAudienceToSql(ctx, { ast }, opts);
    expect(one.sql).toBe(two.sql);
    expect(one.params).toEqual(two.params);
  });

  it('starts numbering at paramOffset + 1', async () => {
    const out = await compileAudienceToSql(
      ctx,
      { ast },
      { alias: 'a', paramOffset: 5, asOf, timezone: 'Europe/Prague' },
    );
    expect(out.sql).toContain('$6');
    expect(out.sql).not.toMatch(/\$[1-5]\b/);
    expect(out.params).toHaveLength(5);
  });

  it('never contains a bare c. when the alias is x', async () => {
    const out = await compileAudienceToSql(
      ctx,
      { ast },
      { alias: 'x', paramOffset: 0, asOf, timezone: 'Europe/Prague' },
    );
    expect(out.sql).not.toMatch(/(^|[^a-z0-9_])c\./);
  });

  it('keeps the envelope even when only listIds are given', async () => {
    const out = await compileAudienceToSql(
      ctx,
      { listIds: ['0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60aa'] },
      { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' },
    );
    expect(out.sql).toContain('a.deleted_at IS NULL');
    expect(out.sql).toContain('a.anonymized_at IS NULL');
    expect(out.sql).toContain('a.processing_restricted = false');
    expect(out.sql).toContain('su.removed_at IS NULL');
  });

  it('unions segmentIds and listIds with OR', async () => {
    const out = await compileAudienceToSql(
      ctx,
      {
        listIds: ['0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60aa'],
        segmentIds: ['0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60bb'],
      },
      { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' },
    );
    expect(out.sql).toMatch(/\) OR \(/);
  });

  it('puts no user value into the query text', async () => {
    const evil: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'attribute', key: 'city' },
            operator: 'eq',
            value: "'; DROP TABLE contacts; --",
          },
        ],
      },
    };
    const out = await compileAudienceToSql(
      ctx,
      { ast: evil },
      { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' },
    );
    expect(out.sql).not.toContain('DROP TABLE');
    expect(out.params).toContain("'; DROP TABLE contacts; --");
  });
});
