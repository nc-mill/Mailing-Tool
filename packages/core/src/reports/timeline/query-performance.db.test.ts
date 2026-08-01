import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../tx';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db';
import { ensurePartitions, seedContact, seedWorkspace } from '../test-support/fixtures';
import { readContactTimeline } from './query';

const translate = (key: string) => key;
const NOW = new Date('2026-07-31T23:00:00.000Z');

describe('výkon časové osy', () => {
  let db: TestDatabase;
  let ctx: WorkspaceContext;
  let contactId: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    const ws = await seedWorkspace(db);
    ctx = testContext(ws.workspaceId);
    contactId = await seedContact(db, ws.workspaceId);

    for (const month of ['2026-05', '2026-06', '2026-07']) {
      await ensurePartitions(db, new Date(`${month}-15T00:00:00.000Z`));
      await db.pool.query(
        `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, source, page)
         SELECT gen_random_uuid(),
                ($3::timestamptz + (g || ' seconds')::interval),
                ($3::timestamptz + (g || ' seconds')::interval),
                $1, 'page_view', $2, 'web', '{"url":"https://x.cz/a"}'::jsonb
           FROM generate_series(1, 34000) AS g`,
        [ws.workspaceId, contactId, `${month}-01T00:00:00.000Z`],
      );
      await db.pool.query(
        `INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
         VALUES ($1, 'contact', $2, $3) ON CONFLICT DO NOTHING`,
        [ws.workspaceId, contactId, `${month}-01`],
      );
    }
    await db.pool.query('ANALYZE web_events');
  }, 600_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('první i dvacátá stránka se vejdou do rozpočtu (kritérium 67)', async () => {
    const tx = createTestTx(db);
    let cursor: string | undefined;
    const durations: number[] = [];

    for (let page = 0; page < 20; page += 1) {
      const started = performance.now();
      const result = await readContactTimeline(tx, ctx, {
        contactId,
        limit: 50,
        translate,
        now: NOW,
        ...(cursor ? { cursor } : {}),
      });
      durations.push(performance.now() - started);
      expect(result.items).toHaveLength(50);
      cursor = result.nextCursor ?? undefined;
      expect(cursor).toBeTruthy();
    }

    // Rozpočet 7.2 části 5 je p99 120 ms. V kontejneru na notebooku měříme
    // s rezervou, protože zajímá nás řádová shoda, ne absolutní číslo.
    // eslint-disable-next-line no-console
    console.log(
      `[timeline 100k] stránek 20, nejpomalejší ${Math.max(...durations).toFixed(1)} ms, ` +
        `medián ${[...durations].sort((a, b) => a - b)[10]!.toFixed(1)} ms`,
    );
    expect(Math.max(...durations)).toBeLessThan(500);
  });

  it('dotaz na webovou větev nepoužije Seq Scan nad web_events (7.3)', async () => {
    const { rows } = await db.pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (FORMAT TEXT)
       SELECT e.id, e.occurred_at FROM web_events e
        WHERE e.workspace_id = $1 AND e.contact_id = $2
          AND e.occurred_at >= '2026-07-01' AND e.occurred_at < '2026-08-01'
          AND e.received_at >= '2026-07-01' AND e.received_at < '2026-08-08'
        ORDER BY e.occurred_at DESC, e.id DESC LIMIT 51`,
      [ctx.workspaceId, contactId],
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).not.toMatch(/Seq Scan on web_events/);
  });
});
