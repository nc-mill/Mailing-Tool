import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedCampaignStats, seedWorkspace } from '../test-support/fixtures';
import { bucketDrift, readCampaignProgress } from './read';

describe('readCampaignProgress', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedBucket(workspaceId: string, campaignId: string, at: string, sent: number) {
    await db.pool.query(
      `INSERT INTO campaign_stats_buckets
         (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
       VALUES ($1, $2, $3, $4, 0, 0, 0, 0)`,
      [campaignId, workspaceId, at, sent],
    );
  }

  it('vrátí průběh, který zapsal job P10', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: 1129,
      sent: 428,
      failed: 2,
      skipped: 1,
    });

    const progress = await readCampaignProgress(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(progress).toMatchObject({
      sent: 428,
      total: 1129,
      failed: 2,
      skipped: 1,
      isSending: true,
    });
    expect(progress.percent).toBeCloseTo(428 / 1129, 10);
  });

  it('u kampaně bez materializace nevrací procenta, ale null', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'draft' });
    const progress = await readCampaignProgress(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(progress.percent).toBeNull();
    expect(progress.isSending).toBe(false);
  });

  it('nahlásí rozdíl mezi součtem bloků a čítačem, protože obojí píše týž job', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: 100,
      sent: 30,
    });
    await seedBucket(ws.workspaceId, campaign.campaignId, '2026-07-31T12:00:00.000Z', 10);
    await seedBucket(ws.workspaceId, campaign.campaignId, '2026-07-31T12:05:00.000Z', 10);

    const drift = await bucketDrift(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(drift).toEqual({ statsSent: 30, bucketSum: 20, statsMissing: false, matches: false });
  });

  it('bloky bez řádku souhrnu jsou drift, ne shoda', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    // Bloky už zapsané, souhrn ještě ne. Job z P10 doběhl jen zpola.
    await seedBucket(ws.workspaceId, campaign.campaignId, '2026-07-31T12:00:00.000Z', 20);

    const drift = await bucketDrift(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    // S `FROM campaign_stats` by dotaz nevrátil žádný řádek, obě čísla by byla
    // nula a funkce by ohlásila shodu, tedy pravý opak skutečnosti.
    expect(drift.statsMissing).toBe(true);
    expect(drift.bucketSum).toBe(20);
    expect(drift.matches).toBe(false);
  });

  it('u konzistentních dat žádný rozdíl nehlásí', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: 100,
      sent: 20,
    });
    await seedBucket(ws.workspaceId, campaign.campaignId, '2026-07-31T12:00:00.000Z', 20);

    const drift = await bucketDrift(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(drift.matches).toBe(true);
  });

  it('kampaň jiného projektu hlásí not_found', async () => {
    const mine = await seedWorkspace(db);
    const other = await seedWorkspace(db);
    const campaign = await seedCampaign(db, other.workspaceId);
    await expect(
      readCampaignProgress(createTestTx(db), testContext(mine.workspaceId), campaign.campaignId),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
