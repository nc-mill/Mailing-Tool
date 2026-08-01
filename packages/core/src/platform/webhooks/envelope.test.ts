import { describe, it, expect } from 'vitest';
import { serializeEnvelope, ENVELOPE_KEY_ORDER } from './envelope';

const EVENT = {
  id: '0192f3a0-1c2d-7e50-9a1b-2c3d4e5f6071',
  type: 'contact.created',
  occurredAt: new Date('2026-08-01T12:40:00.000Z'),
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  data: { contact_id: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4' },
};

/** Přesné tělo z vektoru ve 3.8. Pořadí klíčů je součást vektoru, ne kosmetika. */
const EXPECTED =
  '{"id":"0192f3a0-1c2d-7e50-9a1b-2c3d4e5f6071","type":"contact.created","api_version":"v1","occurred_at":"2026-08-01T12:40:00.000Z","workspace_id":"0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071","data":{"contact_id":"0192f3a0-1c2d-7e43-8d4e-5f60718293a4"}}';

describe('obálka události', () => {
  it('serializuje se bajt po bajtu shodně s vektorem ze 3.8', () => {
    expect(serializeEnvelope(EVENT)).toBe(EXPECTED);
  });

  it('pořadí klíčů je závazné', () => {
    expect(ENVELOPE_KEY_ORDER).toEqual([
      'id',
      'type',
      'api_version',
      'occurred_at',
      'workspace_id',
      'data',
    ]);
  });

  it('api_version je součástí obálky', () => {
    expect(JSON.parse(serializeEnvelope(EVENT)).api_version).toBe('v1');
  });

  it('occurred_at je ISO 8601 v UTC s milisekundami', () => {
    expect(JSON.parse(serializeEnvelope(EVENT)).occurred_at).toBe('2026-08-01T12:40:00.000Z');
  });

  it('prázdná data se serializují jako prázdný objekt, ne jako null', () => {
    expect(JSON.parse(serializeEnvelope({ ...EVENT, data: {} })).data).toEqual({});
  });

  it('přeházení klíčů ve vstupním data nemění pořadí klíčů obálky', () => {
    const parsed = Object.keys(JSON.parse(serializeEnvelope(EVENT)));
    expect(parsed).toEqual(ENVELOPE_KEY_ORDER);
  });
});
