import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db';
import { ensurePartitions, seedContact, seedWorkspace } from '../test-support/fixtures';
import { readContactTimeline } from './query';

const translate = (key: string, values: Record<string, unknown>) =>
  `${key}:${values['gender'] ?? ''}`;

describe('readContactTimeline', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedWebEvents(
    workspaceId: string,
    contactId: string,
    count: number,
    month: string,
  ) {
    await ensurePartitions(db, new Date(`${month}-15T00:00:00.000Z`));
    await db.pool.query(
      `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, source, page)
       SELECT gen_random_uuid(),
              ($4::timestamptz + (g || ' seconds')::interval),
              ($4::timestamptz + (g || ' seconds')::interval),
              $1, 'page_view', $2, 'web', '{"url":"https://x.cz/a"}'::jsonb
         FROM generate_series(1, $3) AS g`,
      [workspaceId, contactId, count, `${month}-15T00:00:00.000Z`],
    );
    await db.pool.query(
      `INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
       VALUES ($1, 'contact', $2, $3) ON CONFLICT DO NOTHING`,
      [workspaceId, contactId, `${month}-01`],
    );
  }

  it('vrátí první stránku seřazenou od nejnovější položky', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvents(ws.workspaceId, contact, 60, '2026-07');

    const page = await readContactTimeline(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      limit: 50,
      translate,
      now: new Date('2026-07-31T23:00:00.000Z'),
    });
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(new Date(page.items[0]!.occurred_at).getTime()).toBeGreaterThan(
      new Date(page.items[49]!.occurred_at).getTime(),
    );
    expect(page.items[0]?.title).toContain('timeline.item.pageView');
  });

  it('druhá stránka nenavazuje duplicitou ani mezerou', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvents(ws.workspaceId, contact, 60, '2026-07');
    const tx = createTestTx(db);
    const ctx = testContext(ws.workspaceId);
    const first = await readContactTimeline(tx, ctx, {
      contactId: contact,
      limit: 50,
      translate,
      now: new Date('2026-07-31T23:00:00.000Z'),
    });
    const second = await readContactTimeline(tx, ctx, {
      contactId: contact,
      limit: 50,
      translate,
      now: new Date('2026-07-31T23:00:00.000Z'),
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    expect(second.items).toHaveLength(10);
    const ids = new Set(first.items.map((i) => i.id));
    expect(second.items.some((i) => ids.has(i.id))).toBe(false);
  });

  it('přeskočí měsíce bez dat a najde starší položky (chování 3.12.2)', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvents(ws.workspaceId, contact, 3, '2026-02');

    const page = await readContactTimeline(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      limit: 50,
      translate,
      now: new Date('2026-07-31T23:00:00.000Z'),
    });
    expect(page.items).toHaveLength(3);
  });

  it('filtr podle zdroje vrátí jen požadované položky', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvents(ws.workspaceId, contact, 5, '2026-07');

    const page = await readContactTimeline(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      limit: 50,
      translate,
      types: ['email'],
      now: new Date('2026-07-31T23:00:00.000Z'),
    });
    expect(page.items).toEqual([]);
  });

  it('odmítne rozsah delší než tři měsíce kódem tracking_timeline_window_too_large', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await expect(
      readContactTimeline(createTestTx(db), testContext(ws.workspaceId), {
        contactId: contact,
        limit: 50,
        translate,
        from: new Date('2025-01-01T00:00:00.000Z'),
        to: new Date('2026-01-01T00:00:00.000Z'),
        now: new Date('2026-07-31T23:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'tracking_timeline_window_too_large' });
  });

  it('u neexistujícího kontaktu hlásí not_found', async () => {
    const ws = await seedWorkspace(db);
    await expect(
      readContactTimeline(createTestTx(db), testContext(ws.workspaceId), {
        contactId: '00000000-0000-4000-8000-000000000000',
        limit: 50,
        translate,
        now: new Date('2026-07-31T23:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
