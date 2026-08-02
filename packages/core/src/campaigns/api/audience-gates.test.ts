import { describe, expect, it } from 'vitest';
import { INERT_GATES, type AudienceBreakdown } from '../../segments/audience';
import { toGateCounts, ZERO_GATE_COUNTS } from './audience-gates';

const breakdown: AudienceBreakdown = {
  input: 1208,
  gates: [
    { key: 'suppressed', count: 12 },
    { key: 'unsubscribed', count: 43 },
    { key: 'unconfirmed', count: 17 },
    { key: 'snoozed', count: 4 },
    { key: 'processing_restricted', count: 3 },
    { key: 'duplicate', count: 0 },
    { key: 'sample', count: 0 },
  ],
  willSend: 1129,
};

describe('překlad rozpadu publika na jedenáct bran', () => {
  it('má jedenáct klíčů, ne sedm, které umí část 2', () => {
    expect(Object.keys(toGateCounts(breakdown))).toHaveLength(11);
    expect(Object.keys(ZERO_GATE_COUNTS)).toHaveLength(11);
  });

  it('mapuje brány jmenovitě a nic neslévá do souhrnu', () => {
    const counts = toGateCounts(breakdown);
    expect(counts.excluded_suppressed).toBe(12);
    expect(counts.excluded_unsubscribed).toBe(43);
    expect(counts.excluded_unconfirmed).toBe(17);
    expect(counts.excluded_snoozed).toBe(4);
    expect(counts.excluded_processing_restricted).toBe(3);
  });

  it('vstupní a výsledný počet jde z části 2, ne z dopočtu', () => {
    const counts = toGateCounts(breakdown);
    expect(counts.raw).toBe(1208);
    expect(counts.eligible).toBe(1129);
  });

  it('součet bran plus výsledek se rovná vstupnímu počtu', () => {
    const counts = toGateCounts(breakdown);
    const excluded = Object.entries(counts)
      .filter(([key]) => key.startsWith('excluded_') || key === 'duplicates_removed')
      .reduce((sum, [, value]) => sum + value, 0);
    expect(excluded + counts.eligible).toBe(counts.raw);
  });

  it('brány, které část 2 nemá čím naplnit, zůstávají na nule', () => {
    const counts = toGateCounts(breakdown);
    expect(counts.excluded_invalid_email).toBe(0);
    expect(counts.excluded_deleted).toBe(0);
  });

  it('nečinné brány jsou dvě a test je drží, aby se na omezení nezapomnělo', () => {
    // `duplicate` a `sample` jsou v části 2 natvrdo nula. Řádek s ukázkovými kontakty
    // proto ukáže nulu i tehdy, když je materializace doopravdy vyhodí. Až část 2
    // brány naplní, tenhle výčet se zmenší a test spadne, což je přesně to, co chci.
    expect([...INERT_GATES].sort()).toEqual(['duplicate', 'sample']);
  });
});
