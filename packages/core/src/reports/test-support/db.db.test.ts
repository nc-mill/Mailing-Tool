import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './db';
import { seedWorkspace } from './fixtures';

describe('testovací databáze', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('má po migracích všechny tabulky, ze kterých reporty čtou', async () => {
    const { rows } = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = new Set(rows.map((r) => r.table_name));
    for (const table of [
      'campaign_stats',
      'campaign_stats_buckets',
      'campaign_link_stats',
      'message_engagement',
      'message_events',
      'messages',
      'web_events',
      'web_event_months',
    ]) {
      expect(names.has(table), `chybí tabulka ${table}`).toBe(true);
    }
  });

  it('seedWorkspace založí projekt a vrátí kontext', async () => {
    const ws = await seedWorkspace(db);
    expect(ws.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM workspaces WHERE id = $1`,
      [ws.workspaceId],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });
});
