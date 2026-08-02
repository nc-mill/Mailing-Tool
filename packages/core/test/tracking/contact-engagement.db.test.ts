import { randomUUID } from 'node:crypto';
import { ensurePartitionsForRange } from '@mlain/db/partitions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { recomputeContactEngagement } from '../../src/tracking/index';
import { rebuildEngagement } from '../../src/ops/rebuild-engagement';

let pg: TestPostgres;
let workspaceId: string;
let campaignId: string;
let contactIds: string[] = [];

/**
 * Pevný čas na začátku měsíce, ne `now() - 30 dní`. `message_engagement` je
 * dělená po měsících a migrace zakládají aktuální měsíc a tři dopředu, takže
 * relativní čas do minulosti by v prvních dnech měsíce spadl do oddílu, který
 * neexistuje. Oddíl se proto zakládá výslovně, stejným kódem jako v migracích.
 */
const now = new Date();
const BASE_AT = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 6, 0, 0));

/**
 * Otevření a proklik se zapisují do `first_human_*`, tedy do OVĚŘENÝCH sloupců.
 * Sloupce `open_count` a `click_count` schválně nesou vyšší čísla: přepočet je
 * počítat nesmí, protože zahrnují i Apple proxy a boty (kritérium 75 části 5).
 */
async function seedEngagement(input: {
  contactId: string;
  sent: number;
  humanOpens: number;
  humanClicks: number;
  proxyOpens?: number;
}): Promise<void> {
  const base = BASE_AT.getTime();
  for (let i = 0; i < input.sent; i += 1) {
    const createdAt = new Date(base + i * 3600 * 1000);
    const opened = i < input.humanOpens;
    const clicked = i < input.humanClicks;
    await pg.sql(
      `INSERT INTO message_engagement (
         message_id, created_at, workspace_id, campaign_id, contact_id,
         first_open_at, last_open_at, open_count,
         first_human_open_at, human_open_count,
         first_click_at, last_click_at, click_count,
         first_human_click_at, human_click_count)
       VALUES ($1, $2, $3, $4, $5,
               $6, $6, $7,
               $8, $9,
               $10, $10, $11,
               $10, $12)`,
      [
        randomUUID(),
        createdAt,
        workspaceId,
        campaignId,
        input.contactId,
        opened ? createdAt : null,
        // open_count nese i proxy otevření, ověřená jsou jen human_open_count.
        (opened ? 1 : 0) + (input.proxyOpens ?? 0),
        opened ? createdAt : null,
        opened ? 1 : 0,
        clicked ? createdAt : null,
        clicked ? 1 : 0,
        clicked ? 1 : 0,
      ],
    );
  }
}

beforeAll(async () => {
  pg = await startTestPostgres();
  ({ workspaceId } = await pg.seedMinimalInstallation({ contacts: 3 }));
  ({ campaignId } = await pg.seedSentCampaign({ workspaceId }));
  const rows = await pg.sql<{ id: string }>(
    'SELECT id FROM contacts WHERE workspace_id = $1 ORDER BY id',
    [workspaceId],
  );
  contactIds = rows.map((r) => r.id);

  await ensurePartitionsForRange(
    pg.as('mlain_migrator'),
    'message_engagement',
    'created_at',
    BASE_AT,
    new Date(Date.UTC(BASE_AT.getUTCFullYear(), BASE_AT.getUTCMonth() + 1, 1)),
  );

  await seedEngagement({
    contactId: contactIds[0]!,
    sent: 4,
    humanOpens: 3,
    humanClicks: 1,
    proxyOpens: 5,
  });
  await seedEngagement({ contactId: contactIds[1]!, sent: 2, humanOpens: 0, humanClicks: 0 });
  // Třetí kontakt zprávy nedostal. Řádek v contact_engagement mít nesmí:
  // zakládá se líně, až při první události (kritérium 76 části 5).
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe('recomputeContactEngagement', () => {
  it('spočítá součty a poslední časy ze zdroje pravdy', async () => {
    const result = await pg.inWorkspace(workspaceId, (tx) =>
      recomputeContactEngagement(tx, { workspaceId, batchSize: 100, cursor: null }),
    );
    expect(result.processed).toBe(2);
    expect(result.nextCursor).toBeNull();

    const rows = await pg.sql<{
      contact_id: string;
      sent_total: number;
      opens_total: number;
      clicks_total: number;
      last_open_at: Date | null;
    }>(
      `SELECT contact_id, sent_total, opens_total, clicks_total, last_open_at
         FROM contact_engagement WHERE workspace_id = $1 ORDER BY contact_id`,
      [workspaceId],
    );

    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.contact_id === contactIds[0])!;
    expect(first.sent_total).toBe(4);
    // Ne 8: proxy otevření se nepočítají, jen ověřená.
    expect(first.opens_total).toBe(3);
    expect(first.clicks_total).toBe(1);
    expect(first.last_open_at).not.toBeNull();

    const second = rows.find((r) => r.contact_id === contactIds[1])!;
    expect(second.sent_total).toBe(2);
    expect(second.opens_total).toBe(0);
    expect(second.last_open_at).toBeNull();
  });

  it('kontakt bez jediné zprávy řádek nedostane (kritérium 76)', async () => {
    const rows = await pg.sql<{ n: string }>(
      'SELECT count(*) AS n FROM contact_engagement WHERE workspace_id = $1 AND contact_id = $2',
      [workspaceId, contactIds[2]],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('je idempotentní: druhý běh dá tatáž čísla', async () => {
    const before = await pg.sql(
      `SELECT contact_id, sent_total, opens_total, clicks_total
         FROM contact_engagement WHERE workspace_id = $1 ORDER BY contact_id`,
      [workspaceId],
    );
    await pg.inWorkspace(workspaceId, (tx) =>
      recomputeContactEngagement(tx, { workspaceId, batchSize: 100, cursor: null }),
    );
    const after = await pg.sql(
      `SELECT contact_id, sent_total, opens_total, clicks_total
         FROM contact_engagement WHERE workspace_id = $1 ORDER BY contact_id`,
      [workspaceId],
    );
    expect(after).toEqual(before);
  });

  it('rozbitá čísla srovná zpátky (kritérium 77)', async () => {
    const before = await pg.sql(
      `SELECT contact_id, sent_total, opens_total, clicks_total
         FROM contact_engagement WHERE workspace_id = $1 ORDER BY contact_id`,
      [workspaceId],
    );
    await pg.sql(
      'UPDATE contact_engagement SET opens_total = 0, clicks_total = 0 WHERE workspace_id = $1',
      [workspaceId],
    );
    await rebuildEngagement({ adminUrl: pg.ownerUrl, workspaceId, batchSize: 10 });
    const after = await pg.sql(
      `SELECT contact_id, sent_total, opens_total, clicks_total
         FROM contact_engagement WHERE workspace_id = $1 ORDER BY contact_id`,
      [workspaceId],
    );
    expect(after).toEqual(before);
  });

  it('sloupce, které ze zdroje nejdou dopočítat, přepočet nepřepíše', async () => {
    await pg.sql(
      `UPDATE contact_engagement
          SET bounces_total = 2, delivered_total = 7, consecutive_no_open = 5
        WHERE workspace_id = $1 AND contact_id = $2`,
      [workspaceId, contactIds[0]],
    );
    await pg.inWorkspace(workspaceId, (tx) =>
      recomputeContactEngagement(tx, { workspaceId, batchSize: 100, cursor: null }),
    );
    const rows = await pg.sql<{
      bounces_total: number;
      delivered_total: number;
      consecutive_no_open: number;
    }>(
      `SELECT bounces_total, delivered_total, consecutive_no_open
         FROM contact_engagement WHERE workspace_id = $1 AND contact_id = $2`,
      [workspaceId, contactIds[0]],
    );
    expect(rows[0]).toMatchObject({
      bounces_total: 2,
      delivered_total: 7,
      consecutive_no_open: 5,
    });
  });

  it('dávkuje přes kurzor a každý kontakt zpracuje právě jednou', async () => {
    const first = await pg.inWorkspace(workspaceId, (tx) =>
      recomputeContactEngagement(tx, { workspaceId, batchSize: 1, cursor: null }),
    );
    expect(first.processed).toBe(1);
    expect(first.nextCursor).toBe(contactIds[0]);

    const second = await pg.inWorkspace(workspaceId, (tx) =>
      recomputeContactEngagement(tx, { workspaceId, batchSize: 1, cursor: first.nextCursor }),
    );
    expect(second.processed).toBe(1);
    expect(second.nextCursor).toBe(contactIds[1]);

    const third = await pg.inWorkspace(workspaceId, (tx) =>
      recomputeContactEngagement(tx, { workspaceId, batchSize: 1, cursor: second.nextCursor }),
    );
    expect(third.processed).toBe(0);
    expect(third.nextCursor).toBeNull();
  });

  it('nulová dávka je chyba, ne nekonečná smyčka', async () => {
    await expect(
      pg.inWorkspace(workspaceId, (tx) =>
        recomputeContactEngagement(tx, { workspaceId, batchSize: 0, cursor: null }),
      ),
    ).rejects.toThrow(/dávk/i);
  });

  it('přepočet jednoho projektu nesáhne do druhého', async () => {
    const other = await pg.seedMinimalInstallation({
      contacts: 1,
      ownerEmail: 'jiny@example.test',
    });
    const result = await pg.inWorkspace(other.workspaceId, (tx) =>
      recomputeContactEngagement(tx, {
        workspaceId: other.workspaceId,
        batchSize: 100,
        cursor: null,
      }),
    );
    expect(result.processed).toBe(0);
    const rows = await pg.sql<{ n: string }>(
      'SELECT count(*) AS n FROM contact_engagement WHERE workspace_id = $1',
      [other.workspaceId],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
