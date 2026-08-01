import { describe, expect, it } from 'vitest';
import { SegmentAstV1 } from './ast';

const valid = {
  version: 1,
  root: {
    type: 'group',
    op: 'and',
    not: false,
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
        operator: 'in',
        values: ['Praha', 'Brno'],
      },
    ],
  },
};

describe('SegmentAstV1', () => {
  it('accepts a well formed tree', () => {
    expect(SegmentAstV1.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown field kind', () => {
    const bad = structuredClone(valid);
    (bad.root.children[0] as unknown as { field: { kind: string } }).field.kind = 'sql';
    expect(() => SegmentAstV1.parse(bad)).toThrow();
  });

  it('rejects an unknown contact key', () => {
    const bad = structuredClone(valid);
    (bad.root.children[0] as unknown as { field: { key: string } }).field.key = 'password_hash';
    expect(() => SegmentAstV1.parse(bad)).toThrow();
  });

  it('rejects an extra property', () => {
    const bad = { ...valid, evil: true };
    expect(() => SegmentAstV1.parse(bad)).toThrow();
  });

  it('rejects an empty group', () => {
    expect(() =>
      SegmentAstV1.parse({ version: 1, root: { type: 'group', op: 'and', children: [] } }),
    ).toThrow();
  });

  it('rejects more than 50 children in one group', () => {
    const child = {
      type: 'condition',
      field: { kind: 'contact', key: 'status' },
      operator: 'eq',
      value: 'active',
    };
    const bad = {
      version: 1,
      root: { type: 'group', op: 'and', children: Array.from({ length: 51 }, () => child) },
    };
    expect(() => SegmentAstV1.parse(bad)).toThrow();
  });

  it('accepts 50 children and nesting depth 5, which K2 must be able to send', () => {
    const cond = {
      type: 'condition',
      field: { kind: 'contact', key: 'status' },
      operator: 'eq',
      value: 'active',
    };
    let node: unknown = {
      type: 'group',
      op: 'and',
      children: Array.from({ length: 50 }, () => cond),
    };
    for (let i = 1; i < 5; i += 1) node = { type: 'group', op: 'and', children: [node] };
    expect(() => SegmentAstV1.parse({ version: 1, root: node })).not.toThrow();
  });
});
