import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedContact, seedWorkspace } from '../test-support/fixtures';
import { listWebEventMonths, pickWindow } from './months';

describe('mapa měsíců webových událostí', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('vrací měsíce sestupně a jen pro daný kontakt', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    const other = await seedContact(db, ws.workspaceId);
    for (const month of ['2026-05-01', '2026-07-01', '2026-06-01']) {
      await db.pool.query(
        `INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
         VALUES ($1, 'contact', $2, $3)`,
        [ws.workspaceId, contact, month],
      );
    }
    await db.pool.query(
      `INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
       VALUES ($1, 'contact', $2, '2026-01-01')`,
      [ws.workspaceId, other],
    );

    const months = await listWebEventMonths(createTestTx(db), testContext(ws.workspaceId), contact);
    expect(months.map((m) => m.toISOString().slice(0, 7))).toEqual([
      '2026-07',
      '2026-06',
      '2026-05',
    ]);
  });
});

describe('pickWindow', () => {
  const SCOPE = new Date('2020-01-01T00:00:00.000Z');

  it('vezme nejvýš tři měsíce na jeden požadavek', () => {
    const window = pickWindow(new Date('2026-07-31T23:59:59.000Z'), SCOPE, 37);
    expect(window.from.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-07-31T23:59:59.000Z');
  });

  it('nikdy nesestoupí pod začátek rozsahu, který uživatel zvolil', () => {
    const window = pickWindow(
      new Date('2026-07-31T23:59:59.000Z'),
      new Date('2026-07-10T00:00:00.000Z'),
      37,
    );
    expect(window.from.toISOString()).toBe('2026-07-10T00:00:00.000Z');
  });

  it('okno webových událostí sahá o sedm dní dál kvůli offline frontě', () => {
    const window = pickWindow(new Date('2026-07-31T00:00:00.000Z'), SCOPE, 37);
    expect(window.webReceivedTo.getTime() - window.to.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('dolní mez webových událostí má minutovou rezervu, kterou ck_web_events__lag povoluje', () => {
    const window = pickWindow(new Date('2026-07-31T00:00:00.000Z'), SCOPE, 37);
    expect(window.from.getTime() - window.webReceivedFrom.getTime()).toBe(60 * 1000);
  });

  it('okno událostí zprávy je řádově širší než webové, jinak by zpožděný odraz vypadl (R21)', () => {
    const window = pickWindow(new Date('2026-07-31T00:00:00.000Z'), SCOPE, 37);
    expect(window.messageReceivedTo.getTime()).toBeGreaterThan(window.webReceivedTo.getTime());
    // Sedmidenní strop platí jen pro web_events. message_events žádný nemá.
    expect(window.messageReceivedTo.getTime() - window.to.getTime()).toBe(
      37 * 31 * 24 * 60 * 60 * 1000,
    );
  });
});
