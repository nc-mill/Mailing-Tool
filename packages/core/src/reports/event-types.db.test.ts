import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './test-support/db';
import { BOUNCE_TYPES, EVENT_TYPES, TIMELINE_EVENT_TYPES } from './event-types';

describe('EVENT_TYPES', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('se kryje s omezením ck_message_events__type v databázi', async () => {
    const { rows } = await db.pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conname = 'ck_message_events__type'`,
    );
    expect(rows[0], 'omezení ck_message_events__type v databázi není').toBeDefined();
    const inDatabase = [...rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inDatabase).toEqual([...EVENT_TYPES].sort());
  });

  it('každý typ z osy i každý odraz je platná hodnota omezení', () => {
    for (const type of [...TIMELINE_EVENT_TYPES, ...BOUNCE_TYPES]) {
      expect(EVENT_TYPES).toContain(type);
    }
  });

  it('hodnoty bounce a complaint ve slovníku NEJSOU (R19)', () => {
    expect(EVENT_TYPES).not.toContain('bounce');
    expect(EVENT_TYPES).not.toContain('complaint');
  });
});
