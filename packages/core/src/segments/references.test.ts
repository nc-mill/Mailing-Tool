import { describe, expect, it } from 'vitest';
import { assertNestingDepth, assertNoCycle, resolveReferences } from './references';
import { segmentErrorCode } from './errors';
import type { SegmentAst } from './ast';
import type { WorkspaceContext } from '../identity/types';

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

/**
 * Podmínka na štítek nese v `values` IDENTIFIKÁTORY. Kontrola je schválně
 * dřív, než se sáhne do databáze, takže tenhle test žádnou nepotřebuje.
 */
describe('hodnoty podmínky na štítek', () => {
  const ctx = { workspaceId: '019fc763-7184-72dd-a48d-3cf3ec306179' } as WorkspaceContext;
  const withTagValues = (values: string[]): SegmentAst => ({
    version: 1,
    root: {
      type: 'group',
      op: 'and',
      children: [{ type: 'condition', field: { kind: 'tag' }, operator: 'has_any', values }],
    },
  });

  it('odmítne název štítku 422, ne pětistovkou z databáze', async () => {
    // Dřív z tohohle vznikl dotaz `... WHERE tags.id IN ($2)` s hodnotou
    // „Newsletter" a Postgres ho odmítl jako neplatné uuid.
    let caught: unknown;
    try {
      await resolveReferences(ctx, withTagValues(['Newsletter']));
    } catch (error) {
      caught = error;
    }
    expect(caught, 'název štítku měl skončit chybou validace').toBeDefined();
    expect(segmentErrorCode(caught)).toBe('segment_invalid_ast');
    expect((caught as { params?: Record<string, unknown> }).params?.['got']).toBe('Newsletter');
  });

  it('platný identifikátor kontrolou projde a jde se do databáze', async () => {
    // Bez databáze skončí volání jinak, ale rozhodně ne na kontrole hodnoty.
    await expect(
      resolveReferences(ctx, withTagValues(['019fc79f-7b3e-751c-a316-38118b61ec55'])),
    ).rejects.not.toMatchObject({ params: { code: 'segment_invalid_ast' } });
  });
});
