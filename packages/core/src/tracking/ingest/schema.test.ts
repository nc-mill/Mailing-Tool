import { describe, expect, it } from 'vitest';
import { IngestBatchSchema, SUPPORTED_PAYLOAD_VERSIONS, parseBatch } from './schema';

const validEvent = {
  id: '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6071',
  name: 'page_view',
  occurred_at: '2026-07-31T10:00:00.000Z',
};
const validBatch = {
  v: 1,
  key: 'ml_pub_aebagbafaydqqcik',
  sent_at: '2026-07-31T10:00:01.000Z',
  anonymous_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  events: [validEvent],
};

describe('IngestBatchSchema', () => {
  it('přijme platnou dávku', () => {
    expect(IngestBatchSchema.parse(validBatch).events).toHaveLength(1);
  });

  it('podporované verze payloadu jsou vyjmenované a obsahují 1', () => {
    expect(SUPPORTED_PAYLOAD_VERSIONS).toContain(1);
  });

  it('neznámá verze vrátí tracking_payload_version_unsupported a dávka se celá zahodí', () => {
    const result = parseBatch({ ...validBatch, v: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('tracking_payload_version_unsupported');
    expect(result.params).toEqual({ supported: [...SUPPORTED_PAYLOAD_VERSIONS] });
  });

  it('chybějící verze se chová jako neznámá, nedoplňuje se výchozí hodnota', () => {
    // `delete`, ne destrukturalizace se zahozenou proměnnou: ta v tomhle
    // repozitáři padá na pravidle no-unused-vars.
    const withoutVersion: Partial<typeof validBatch> = { ...validBatch };
    delete withoutVersion.v;
    const result = parseBatch(withoutVersion);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('tracking_payload_version_unsupported');
  });

  it('dávka s 51 událostmi skončí kódem too_many_items', () => {
    const result = parseBatch({
      ...validBatch,
      events: Array.from({ length: 51 }, () => validEvent),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('too_many_items');
  });

  it('prázdná dávka je validation_failed', () => {
    const result = parseBatch({ ...validBatch, events: [] });
    expect(result.ok).toBe(false);
  });

  it('neplatné anonymous_id skončí kódem tracking_invalid_anonymous_id', () => {
    const result = parseBatch({ ...validBatch, anonymous_id: 'nic' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('tracking_invalid_anonymous_id');
  });

  it('neznámý klíč v těle se odmítne, tiché ignorování překlepu je nejhorší odpověď', () => {
    expect(() => IngestBatchSchema.parse({ ...validBatch, emial: 'x' })).toThrow();
  });

  it('jméno události mimo povolený tvar dávku neprojde schématem', () => {
    const result = parseBatch({
      ...validBatch,
      events: [{ ...validEvent, name: 'Product Viewed' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('validation_failed');
  });
});
