import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedWorkspace } from '../test-support/fixtures';
import { readCampaignBuckets } from './buckets';

describe('readCampaignBuckets', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedBuckets(workspaceId: string, campaignId: string) {
    const rows: Array<[string, number, number, number, number, number]> = [
      ['2026-07-31T12:00:00.000Z', 100, 90, 10, 2, 1],
      ['2026-07-31T12:05:00.000Z', 200, 190, 30, 5, 0],
      ['2026-07-31T13:00:00.000Z', 50, 48, 8, 1, 0],
      ['2026-08-01T09:00:00.000Z', 10, 10, 2, 0, 0],
    ];
    for (const [at, sent, delivered, opens, clicks, bounced] of rows) {
      await db.pool.query(
        `INSERT INTO campaign_stats_buckets
           (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [campaignId, workspaceId, at, sent, delivered, opens, clicks, bounced],
      );
    }
  }

  it('vrací pětiminutové bloky tak, jak jsou', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedBuckets(ws.workspaceId, campaign.campaignId);
    const result = await readCampaignBuckets(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: '5m',
      timezone: 'Europe/Prague',
    });
    expect(result.points).toHaveLength(4);
    expect(result.points[0]).toMatchObject({ sent: 100, delivered: 90, opensUnique: 10 });
  });

  it('slévá do hodin', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedBuckets(ws.workspaceId, campaign.campaignId);
    const result = await readCampaignBuckets(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: 'hour',
      timezone: 'Europe/Prague',
    });
    expect(result.points).toHaveLength(3);
    expect(result.points[0]).toMatchObject({
      sent: 300,
      delivered: 280,
      opensUnique: 40,
      clicksUnique: 7,
    });
  });

  it('slévá do dnů v časové zóně projektu, ne v UTC', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await db.pool.query(
      `INSERT INTO campaign_stats_buckets
         (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
       VALUES ($1, $2, '2026-07-31T22:30:00.000Z', 7, 7, 0, 0, 0)`,
      [campaign.campaignId, ws.workspaceId],
    );
    const prague = await readCampaignBuckets(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: 'day',
      timezone: 'Europe/Prague',
    });
    const utc = await readCampaignBuckets(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: 'day',
      timezone: 'UTC',
    });
    // 22:30 UTC je 1. srpna v Praze, ale ještě 31. července v UTC.
    expect(prague.points[0]?.at).not.toBe(utc.points[0]?.at);
  });

  it('u kampaně jiného projektu vrací prázdno', async () => {
    const mine = await seedWorkspace(db);
    const other = await seedWorkspace(db);
    const campaign = await seedCampaign(db, other.workspaceId);
    await seedBuckets(other.workspaceId, campaign.campaignId);
    const result = await readCampaignBuckets(createTestTx(db), testContext(mine.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: '5m',
      timezone: 'UTC',
    });
    expect(result.points).toEqual([]);
  });
});
