import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedCampaignStats, seedWorkspace } from '../test-support/fixtures';
import { campaignStatsRoutes } from './campaign-stats.routes';
import { createTestApp } from './test-app';

describe('GET /campaigns/{id}/stats', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  function appFor(workspaceId: string) {
    return createTestApp(testContext(workspaceId), createTestTx(db), [
      campaignStatsRoutes as never,
    ]);
  }

  it('vrátí souhrn v snake_case s ETagem z verze', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 1000,
      delivered: 1000,
      opens_unique: 500,
      opens_unique_human: 200,
      opens_unique_apple: 300,
      clicks_unique_human: 187,
    });

    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/stats`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      campaign_id: campaign.campaignId,
      delivered_source: 'provider_events',
    });
    expect((body.counts as Record<string, number>).opens_unique_apple).toBe(300);
    expect((body.rates as Record<string, number>).click_rate).toBeCloseTo(0.187, 10);
    expect(response.headers.get('etag')).toBe(`W/"${body.version}"`);
  });

  it('při shodě If-None-Match vrátí 304 bez těla (kritérium 100)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 1 });
    const app = appFor(ws.workspaceId);
    const first = await app.request(`/campaigns/${campaign.campaignId}/stats`);
    const etag = first.headers.get('etag') ?? '';
    const second = await app.request(`/campaigns/${campaign.campaignId}/stats`, {
      headers: { 'If-None-Match': etag },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('kampaň jiného projektu vrátí 404, ne 403', async () => {
    const mine = await seedWorkspace(db);
    const other = await seedWorkspace(db);
    const campaign = await seedCampaign(db, other.workspaceId);
    const response = await appFor(mine.workspaceId).request(
      `/campaigns/${campaign.campaignId}/stats`,
    );
    expect(response.status).toBe(404);
  });

  it('neplatné id vrátí 422 validation_failed', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request('/campaigns/neni-uuid/stats');
    expect(response.status).toBe(422);
  });

  it('vrátí průběh v čase a statistiku odkazů', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await db.pool.query(
      `INSERT INTO campaign_stats_buckets (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
       VALUES ($1, $2, '2026-07-31T12:00:00.000Z', 100, 90, 10, 2, 1)`,
      [campaign.campaignId, ws.workspaceId],
    );
    const app = appFor(ws.workspaceId);
    const timeline = await app.request(
      `/campaigns/${campaign.campaignId}/stats/timeline?granularity=hour`,
    );
    expect(timeline.status).toBe(200);
    expect(((await timeline.json()) as { points: unknown[] }).points).toHaveLength(1);

    const links = await app.request(`/campaigns/${campaign.campaignId}/links`);
    expect(links.status).toBe(200);
    expect(((await links.json()) as { data: unknown[] }).data).toEqual([]);
  });
});
