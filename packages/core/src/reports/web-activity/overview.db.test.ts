import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedContact, seedWebEvent, seedWorkspace } from '../test-support/fixtures';
import { readWebActivityOverview } from './overview';

const HOUR = 60 * 60 * 1000;

describe('readWebActivityOverview', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('odděluje známé lidi od neznámých návštěvníků a skládá z relací návštěvy', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId, { email: 'jana@example.cz' });
    const known = randomUUID();
    const stranger = randomUUID();

    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 3 * HOUR),
      contactId: contact,
      anonymousId: randomUUID(),
      sessionId: known,
      page: { path: '/vyprodej', referrer: 'https://seznam.cz/hledani?q=bota' },
    });
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'product_viewed',
      occurredAt: new Date(Date.now() - 2 * HOUR),
      contactId: contact,
      sessionId: known,
    });
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 1 * HOUR),
      anonymousId: stranger,
      sessionId: randomUUID(),
      page: { path: '/kontakt' },
    });

    const result = await readWebActivityOverview(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 7,
    });

    expect(result.knownContacts).toBe(1);
    expect(result.anonymousVisitors).toBe(1);
    expect(result.pageViews).toBe(2);
    expect(result.otherEvents).toBe(1);
    expect(result.referrers).toEqual([{ host: 'seznam.cz', visits: 1 }]);
    expect(result.visits).toHaveLength(2);
    // Nejnovější návštěva první, a je to ta neznámá.
    expect(result.visits[0]).toMatchObject({ contactId: null, entryPath: '/kontakt' });
    expect(result.visits[1]).toMatchObject({
      email: 'jana@example.cz',
      pageViews: 1,
      events: 2,
      entryPath: '/vyprodej',
      referrerHost: 'seznam.cz',
    });
  });

  /**
   * Rozdíl mezi „za týden nikdo nepřišel" a „nikdy nic nedorazilo". Obojí je
   * na obrazovce prázdno, ale radí se u toho něco úplně jiného.
   */
  it('prázdné období si pamatuje, že měření někdy něco poslalo', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 10 * 24 * HOUR),
      contactId: contact,
      page: { path: '/stare' },
    });

    const result = await readWebActivityOverview(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 7,
    });

    expect(result.pageViews).toBe(0);
    expect(result.visits).toEqual([]);
    expect(result.lastEventAt).not.toBeNull();
  });

  it('projekt bez jediné události z webu vrací prázdno a přizná, že nikdy nic nedorazilo', async () => {
    const ws = await seedWorkspace(db);
    const result = await readWebActivityOverview(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 30,
    });

    expect(result.knownContacts).toBe(0);
    expect(result.anonymousVisitors).toBe(0);
    expect(result.pages).toEqual([]);
    expect(result.lastEventAt).toBeNull();
  });

  it('události mailu se do webové aktivity nepletou', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'email_opened',
      source: 'email',
      occurredAt: new Date(Date.now() - 1 * HOUR),
      contactId: contact,
      properties: { campaign_id: randomUUID(), open_class: 'human' },
    });

    const result = await readWebActivityOverview(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 7,
    });
    expect(result.knownContacts).toBe(0);
    expect(result.otherEvents).toBe(0);
    expect(result.lastEventAt).toBeNull();
  });

  it('smazaný kontakt se nepočítá mezi známé lidi', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 1 * HOUR),
      contactId: contact,
      anonymousId: randomUUID(),
      page: { path: '/vyprodej' },
    });
    await db.pool.query(`UPDATE contacts SET deleted_at = now() WHERE id = $1`, [contact]);

    const result = await readWebActivityOverview(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 7,
    });
    expect(result.knownContacts).toBe(0);
    // Návštěva samotná nemizí, jen se přestane tvářit jako známý člověk.
    expect(result.anonymousVisitors).toBe(1);
    expect(result.visits[0]).toMatchObject({ contactId: null });
  });
});
