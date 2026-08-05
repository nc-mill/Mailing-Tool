import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedContact, seedWebEvent, seedWorkspace } from '../test-support/fixtures';
import { createTestApp } from './test-app';
import { webActivityRoutes } from './web-activity.routes';

const HOUR = 60 * 60 * 1000;

describe('cesty webové aktivity', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  function appFor(workspaceId: string) {
    return createTestApp(testContext(workspaceId), createTestTx(db), [webActivityRoutes as never]);
  }

  it('GET /campaigns/{id}/web-activity vrací snake_case a čísla z připsaných návštěv', async () => {
    const ws = await seedWorkspace(db);
    const startedAt = new Date(Date.now() - 5 * HOUR);
    const campaign = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: startedAt });
    const contact = await seedContact(db, ws.workspaceId, { email: 'jana@example.cz' });

    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'email_clicked',
      source: 'email',
      occurredAt: new Date(Date.now() - 4 * HOUR),
      contactId: contact,
      properties: { campaign_id: campaign.campaignId, click_class: 'human' },
    });
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 3 * HOUR),
      contactId: contact,
      sessionId: randomUUID(),
      page: { path: '/vyprodej' },
    });

    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/web-activity`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      campaign_id: campaign.campaignId,
      window_hours: 24,
      clicked_contacts: 1,
      visitor_contacts: 1,
      page_views: 1,
    });
    expect(body['pages']).toEqual([{ path: '/vyprodej', views: 1, visitors: 1 }]);
    expect((body['visitors'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      contact_id: contact,
      email: 'jana@example.cz',
    });
  });

  it('neznámá kampaň končí 404, ne prázdným souhrnem', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${randomUUID()}/web-activity`,
    );
    expect(response.status).toBe(404);
  });

  it('GET /web-activity vrací přehled za zvolené období', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 2 * HOUR),
      contactId: contact,
      page: { path: '/vyprodej', referrer: 'https://seznam.cz/' },
    });

    const response = await appFor(ws.workspaceId).request('/web-activity?period=7');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ period_days: 7, known_contacts: 1, page_views: 1 });
    expect(body['referrers']).toEqual([{ host: 'seznam.cz', visits: 1 }]);
  });

  it('nepodporované období skončí na validaci, ne na tichém dopočtu', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request('/web-activity?period=365');
    expect(response.status).toBe(422);
  });
});
