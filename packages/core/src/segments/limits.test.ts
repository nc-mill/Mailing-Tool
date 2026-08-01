import { describe, expect, it } from 'vitest';
import { assertWithinLimits, SEGMENT_LIMITS } from './limits';
import { segmentErrorCode } from './errors';
import type { GroupNode, Node } from './ast';

const cond = (): Node => ({
  type: 'condition',
  field: { kind: 'contact', key: 'status' },
  operator: 'eq',
  value: 'active',
});
const group = (children: Node[], op: 'and' | 'or' = 'and'): GroupNode => ({
  type: 'group',
  op,
  children,
});

function nest(depth: number): GroupNode {
  let node = group([cond()]);
  for (let i = 1; i < depth; i += 1) node = group([node]);
  return node;
}

function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'operace měla selhat, ale prošla').toBeDefined();
  expect(segmentErrorCode(caught)).toBe(code);
}

describe('segment limits', () => {
  it('accepts depth 5 with 50 children and 100 conditions', () => {
    const wide = group(Array.from({ length: 50 }, cond));
    const deep: GroupNode = { type: 'group', op: 'and', children: [nest(4), wide] };
    expect(() => assertWithinLimits({ version: 1, root: deep })).not.toThrow();
  });

  it('rejects depth 6', () => {
    expectCode(() => assertWithinLimits({ version: 1, root: nest(6) }), 'segment_too_deep');
  });

  it('rejects 101 conditions', () => {
    const root = group(Array.from({ length: 3 }, () => group(Array.from({ length: 34 }, cond))));
    expectCode(() => assertWithinLimits({ version: 1, root }), 'segment_too_complex');
  });

  it('rejects 6 engagement conditions', () => {
    const eng = (): Node => ({
      type: 'condition',
      field: { kind: 'engagement', metric: 'opened', scope: { since_days: 90 } },
      operator: 'did',
    });
    expectCode(
      () => assertWithinLimits({ version: 1, root: group(Array.from({ length: 6 }, eng)) }),
      'segment_too_many_engagement',
    );
  });

  it('rejects 4 event conditions', () => {
    const ev = (): Node => ({
      type: 'condition',
      field: { kind: 'event', name: 'purchase' },
      operator: 'did',
    });
    expectCode(
      () => assertWithinLimits({ version: 1, root: group(Array.from({ length: 4 }, ev)) }),
      'segment_too_many_event',
    );
  });

  it('rejects a definition over 256 kB', () => {
    const big = group([{ ...cond(), value: 'x'.repeat(300_000) } as Node]);
    expectCode(() => assertWithinLimits({ version: 1, root: big }), 'segment_definition_too_large');
  });

  it('exposes the documented limit values', () => {
    expect(SEGMENT_LIMITS).toEqual({
      maxConditions: 100,
      maxDepth: 5,
      maxChildren: 50,
      maxEngagement: 5,
      maxEvent: 3,
      maxSegmentNesting: 2,
      maxInItems: 1000,
      maxSqlBytes: 65536,
      maxDefinitionBytes: 262144,
    });
  });
});
