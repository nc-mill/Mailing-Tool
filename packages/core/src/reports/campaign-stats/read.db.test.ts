import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedCampaignStats, seedWorkspace } from '../test-support/fixtures';
import { readCampaignStats } from './read';

describe('readCampaignStats', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('vrátí nuly a verzi 0 pro kampaň, která ještě nemá řádek agregace', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'draft' });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.counts.sent).toBe(0);
    expect(result.version).toBe(0);
    expect(result.status).toBe('draft');
    expect(result.rates.openRate).toBeNull();
  });

  it('složí souhrn z campaign_stats a spočítá míry', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { providerType: 'ses' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: 1000,
      sent: 1000,
      delivered: 1000,
      opens_unique: 500,
      opens_unique_human: 200,
      opens_unique_apple: 300,
      clicks_unique_human: 187,
      unsubscribed: 4,
    });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.deliveredSource).toBe('provider_events');
    expect(result.deliveredEffective).toBe(1000);
    expect(result.rates.clickRate).toBeCloseTo(0.187, 10);
    expect(result.rates.verifiedOpenRate).toBeCloseTo(200 / 700, 10);
    expect(result.breakdown).toMatchObject({ verified: 200, machine: 300, uncertain: 0 });
    expect(result.smallSample).toBe(false);
    expect(result.version).toBeGreaterThan(0);
  });

  it('u SMTP provideru odvozuje doručení z odeslaných', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { providerType: 'smtp' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 100,
      delivered: 0,
      bounced_hard: 3,
      failed: 1,
    });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.deliveredSource).toBe('derived_from_sent');
    expect(result.deliveredEffective).toBe(96);
  });

  it('u kampaně s vypnutým měřením otevření vrací null místo nuly (kritérium 65)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { trackOpens: false });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 500, delivered: 500 });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.trackOpens).toBe(false);
    expect(result.rates.openRate).toBeNull();
  });

  it('označí malý vzorek pod dvěma sty doručenými (kritérium 66)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 150, delivered: 150 });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.smallSample).toBe(true);
  });

  it('kampaň jiného projektu hlásí not_found, ne forbidden (kvůli enumeraci)', async () => {
    const mine = await seedWorkspace(db);
    const other = await seedWorkspace(db);
    const campaign = await seedCampaign(db, other.workspaceId);
    await expect(
      readCampaignStats(createTestTx(db), testContext(mine.workspaceId), campaign.campaignId),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
