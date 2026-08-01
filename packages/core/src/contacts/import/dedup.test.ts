import { describe, expect, it } from 'vitest';
import { BatchDeduper } from './dedup';
import type { ProcessedOkRow } from './row-pipeline';

const row = (email: string, rowNumber: number): ProcessedOkRow => ({
  kind: 'ok',
  email,
  rowNumber,
  contact: { email, attributes: {} },
  attributes: {},
  tags: [],
  subscribe: true,
  consent: null,
  warnings: [],
});

describe('deduplication', () => {
  it('keeps the last occurrence inside one batch and warns about the earlier one', () => {
    const d = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 1000 });
    const out = d.dedupeBatch([row('a@x.cz', 1), row('b@x.cz', 2), row('a@x.cz', 3)]);
    expect(out.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(out.warnings).toEqual([{ rowNumber: 1, code: 'duplicate_in_file' }]);
  });

  it('keeps the first occurrence in first mode', () => {
    const d = new BatchDeduper({ mode: 'first', inMemoryMaxRows: 1000 });
    const out = d.dedupeBatch([row('a@x.cz', 1), row('a@x.cz', 3)]);
    expect(out.rows.map((r) => r.rowNumber)).toEqual([1]);
  });

  it('treats addresses differing only in case as the same', () => {
    const d = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 1000 });
    const out = d.dedupeBatch([row('A@x.cz'.toLowerCase(), 1), row('a@x.cz', 2)]);
    expect(out.rows).toHaveLength(1);
  });

  it('removes a duplicate spanning the first and last position of a batch', () => {
    const rows = [
      row('a@x.cz', 1),
      ...Array.from({ length: 998 }, (_, i) => row(`c${i}@x.cz`, i + 2)),
      row('a@x.cz', 1000),
    ];
    const out = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 5000 }).dedupeBatch(rows);
    expect(out.rows).toHaveLength(999);
  });

  it('reports an error on the second occurrence in error mode', () => {
    const d = new BatchDeduper({ mode: 'error', inMemoryMaxRows: 1000 });
    const out = d.dedupeBatch([row('a@x.cz', 1), row('a@x.cz', 2)]);
    expect(out.errors).toEqual([{ rowNumber: 2, code: 'duplicate_in_file' }]);
  });

  it('keeps level A working after the cross batch memory is disabled', () => {
    const d = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 0 });
    expect(d.crossBatchEnabled).toBe(false);
    const out = d.dedupeBatch([row('a@x.cz', 1), row('a@x.cz', 2)]);
    expect(out.rows).toHaveLength(1);
  });

  it('detects a cross batch duplicate while the memory is on', () => {
    const d = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 1000 });
    d.dedupeBatch([row('a@x.cz', 1)]);
    const out = d.dedupeBatch([row('a@x.cz', 2)]);
    expect(out.warnings).toEqual([{ rowNumber: 1, code: 'duplicate_in_file' }]);
  });
});
