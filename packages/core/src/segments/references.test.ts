import { describe, expect, it } from 'vitest';
import { assertNestingDepth, assertNoCycle } from './references';
import { segmentErrorCode } from './errors';

const graph = new Map<string, string[]>([
  ['A', ['B']],
  ['B', ['C']],
  ['C', []],
]);

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

describe('segment reference graph', () => {
  it('accepts an acyclic graph', () => {
    expect(() => assertNoCycle('A', graph)).not.toThrow();
  });

  it('rejects a two node cycle', () => {
    const cyclic = new Map(graph);
    cyclic.set('C', ['A']);
    expectCode(() => assertNoCycle('A', cyclic), 'segment_cycle');
  });

  it('rejects a self reference', () => {
    expectCode(() => assertNoCycle('A', new Map([['A', ['A']]])), 'segment_cycle');
  });

  it('rejects nesting deeper than two', () => {
    expectCode(
      () =>
        assertNestingDepth(
          'A',
          new Map([
            ['A', ['B']],
            ['B', ['C']],
            ['C', ['D']],
            ['D', []],
          ]),
        ),
      'segment_nesting_too_deep',
    );
  });

  it('accepts nesting of exactly two', () => {
    expect(() => assertNestingDepth('A', graph)).not.toThrow();
  });
});
