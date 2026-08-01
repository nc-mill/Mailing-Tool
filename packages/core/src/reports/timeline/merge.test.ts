import { describe, expect, it } from 'vitest';
import { mergeSortedBranches } from './merge';
import type { TimelineRow } from './types';

function row(id: string, iso: string): TimelineRow {
  return { id, occurredAt: new Date(iso), source: 'web', type: 'page_view', slots: {} };
}

describe('mergeSortedBranches', () => {
  it('slije seřazené větve sestupně podle času', () => {
    const merged = mergeSortedBranches(
      [
        [row('a', '2026-07-31T12:00:00.000Z'), row('b', '2026-07-30T12:00:00.000Z')],
        [row('c', '2026-07-31T13:00:00.000Z'), row('d', '2026-07-29T12:00:00.000Z')],
      ],
      10,
    );
    expect(merged.map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('při shodném čase řadí sestupně podle id, aby byl kurzor jednoznačný', () => {
    const merged = mergeSortedBranches(
      [[row('a1', '2026-07-31T12:00:00.000Z')], [row('a2', '2026-07-31T12:00:00.000Z')]],
      10,
    );
    expect(merged.map((r) => r.id)).toEqual(['a2', 'a1']);
  });

  it('vrátí nejvýš tolik položek, kolik se chce', () => {
    const merged = mergeSortedBranches(
      [[row('a', '2026-07-31T12:00:00.000Z'), row('b', '2026-07-30T12:00:00.000Z')]],
      1,
    );
    expect(merged).toHaveLength(1);
  });

  it('prázdné větve nevadí', () => {
    expect(mergeSortedBranches([[], []], 5)).toEqual([]);
  });
});
