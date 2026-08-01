import { describe, expect, it } from 'vitest';
import { compileSegmentSql } from './index';
import type { SegmentAst } from '../ast';
import { segmentErrorCode } from '../errors';

const ctx = {
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6001',
  asOf: new Date('2026-07-31T10:00:00Z'),
  timezone: 'Europe/Prague',
  fieldClasses: { city: 'text' as const, order_total: 'number' as const },
  segmentKinds: {},
};

const ast = (root: SegmentAst['root']): SegmentAst => ({ version: 1, root });

describe('group compilation', () => {
  it('joins children of an and group with AND', () => {
    const out = compileSegmentSql(
      ast({
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'contact', key: 'status' },
            operator: 'eq',
            value: 'active',
          },
          {
            type: 'condition',
            field: { kind: 'attribute', key: 'city' },
            operator: 'eq',
            value: 'Brno',
          },
        ],
      }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.sql).toMatch(/ AND /);
  });

  it('joins children of an or group with OR', () => {
    const out = compileSegmentSql(
      ast({
        type: 'group',
        op: 'or',
        children: [
          {
            type: 'condition',
            field: { kind: 'contact', key: 'status' },
            operator: 'eq',
            value: 'active',
          },
          {
            type: 'condition',
            field: { kind: 'contact', key: 'status' },
            operator: 'eq',
            value: 'bounced',
          },
        ],
      }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.sql).toMatch(/ OR /);
  });

  it('negates a group with NOT', () => {
    const plain = compileSegmentSql(
      ast({
        type: 'group',
        op: 'or',
        not: false,
        children: [
          {
            type: 'condition',
            field: { kind: 'contact', key: 'status' },
            operator: 'eq',
            value: 'active',
          },
        ],
      }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    const negated = compileSegmentSql(
      ast({
        type: 'group',
        op: 'or',
        not: true,
        children: [
          {
            type: 'condition',
            field: { kind: 'contact', key: 'status' },
            operator: 'eq',
            value: 'active',
          },
        ],
      }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(negated.sql.length).toBeGreaterThan(plain.sql.length);
    expect(negated.sql).toContain('NOT (');
  });

  it('supports negation on a nested group', () => {
    const out = compileSegmentSql(
      ast({
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'group',
            op: 'or',
            not: true,
            children: [
              {
                type: 'condition',
                field: { kind: 'contact', key: 'status' },
                operator: 'eq',
                value: 'active',
              },
            ],
          },
        ],
      }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.sql).toContain('NOT (');
  });

  it('rejects an operator that does not belong to the field class', () => {
    let caught: unknown;
    try {
      compileSegmentSql(
        ast({
          type: 'group',
          op: 'and',
          children: [
            {
              type: 'condition',
              field: { kind: 'attribute', key: 'order_total' },
              operator: 'contains',
              value: 'x',
            },
          ],
        }),
        { alias: 'a', paramOffset: 0, ...ctx },
      );
    } catch (error) {
      caught = error;
    }
    expect(segmentErrorCode(caught)).toBe('segment_operator_not_allowed');
  });

  it('collects warnings from children without duplicates', () => {
    const out = compileSegmentSql(
      ast({
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'engagement', metric: 'opened', scope: { since_days: 45 } },
            operator: 'did',
          },
          {
            type: 'condition',
            field: { kind: 'engagement', metric: 'clicked', scope: { since_days: 45 } },
            operator: 'did',
          },
        ],
      }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.warnings).toEqual(['segment_slow_engagement']);
  });

  it('reserves the three fixed parameters in order', () => {
    const out = compileSegmentSql(
      ast({
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'contact', key: 'status' },
            operator: 'eq',
            value: 'active',
          },
        ],
      }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.params.slice(0, 3)).toEqual([
      ctx.workspaceId,
      ctx.asOf.toISOString(),
      'Europe/Prague',
    ]);
  });
});

/**
 * Tvrdý požadavek zadání: `NOT` nad neznámou hodnotou není `true`.
 *
 * Kontrolujeme to na TEXTU: pod negací se totální predikát obalí do
 * `CASE ... ELSE NULL END` a nikde nesmí být `coalesce(..., false)`,
 * které by neznámo srazilo na nepravdu a `NOT` z něj udělal pravdu.
 * Chování proti databázi ověřuje `segments.db.test.ts`.
 */
describe('three valued logic', () => {
  const attrEq = (not: boolean): SegmentAst =>
    ast({
      type: 'group',
      op: 'and',
      not,
      children: [
        {
          type: 'condition',
          field: { kind: 'attribute', key: 'city' },
          operator: 'eq',
          value: 'Praha',
        },
      ],
    });

  it('never coalesces a leaf to false', () => {
    const out = compileSegmentSql(attrEq(false), { alias: 'a', paramOffset: 0, ...ctx });
    expect(out.sql.toLowerCase()).not.toContain('coalesce(');
  });

  it('makes a totalising containment unknown aware under a negated group', () => {
    const positive = compileSegmentSql(attrEq(false), { alias: 'a', paramOffset: 0, ...ctx });
    const negated = compileSegmentSql(attrEq(true), { alias: 'a', paramOffset: 0, ...ctx });
    expect(positive.sql).not.toContain('CASE WHEN');
    expect(negated.sql).toContain('CASE WHEN');
    expect(negated.sql).toContain('ELSE NULL END');
  });

  it('cancels the negation again at even nesting depth', () => {
    const doubleNegated = ast({
      type: 'group',
      op: 'and',
      not: true,
      children: [
        {
          type: 'group',
          op: 'and',
          not: true,
          children: [
            {
              type: 'condition',
              field: { kind: 'attribute', key: 'city' },
              operator: 'eq',
              value: 'Praha',
            },
          ],
        },
      ],
    });
    const out = compileSegmentSql(doubleNegated, { alias: 'a', paramOffset: 0, ...ctx });
    // Dvojitá negace vrací list do kladné pozice, takže se indexovatelný tvar
    // `@>` nemá čím rozbít a CASE se nevydává.
    expect(out.sql).not.toContain('CASE WHEN');
  });
});
