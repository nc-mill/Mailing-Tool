import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedContact, seedWorkspace } from '../test-support/fixtures';
import { campaignRecipientsRoutes } from './campaign-recipients.routes';
import { contactTimelineRoutes } from './contact-timeline.routes';
import { dashboardRoutes } from './dashboard.routes';
import { createTestApp } from './test-app';

describe('endpointy příjemců, osy a přehledu', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  function appFor(workspaceId: string) {
    return createTestApp(testContext(workspaceId), createTestTx(db), [
      campaignRecipientsRoutes as never,
      contactTimelineRoutes as never,
      dashboardRoutes as never,
    ]);
  }

  it('příjemci vracejí stránkovanou obálku podle konvence 4.3', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/recipients?filter=all&limit=10`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('data');
    expect(body.pagination).toMatchObject({ has_more: false, limit: 10, next_cursor: null });
  });

  it('neznámý filtr příjemců vrátí 422', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/recipients?filter=vsichni_kdo_neco`,
    );
    expect(response.status).toBe(422);
  });

  it('časová osa vrací položky s lokalizovaným title', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId, { gender: 'female' });
    await db.pool.query(
      `UPDATE contacts SET created_at = now() - interval '2 days' WHERE id = $1`,
      [contact],
    );
    const response = await appFor(ws.workspaceId).request(`/contacts/${contact}/timeline`, {
      headers: { 'Accept-Language': 'cs' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ title: string; type: string }> };
    expect(body.data[0]?.type).toBe('contact_created');
    expect(body.data[0]?.title).toBe('Byla přidána do kontaktů');
  });

  it('anglický Accept-Language složí větu z anglického katalogu', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId, { gender: 'male' });
    await db.pool.query(
      `UPDATE contacts SET created_at = now() - interval '2 days' WHERE id = $1`,
      [contact],
    );
    const response = await appFor(ws.workspaceId).request(`/contacts/${contact}/timeline`, {
      headers: { 'Accept-Language': 'en-GB,en;q=0.9' },
    });
    const body = (await response.json()) as { data: Array<{ title: string }> };
    expect(body.data[0]?.title).toBe('Was added to contacts');
  });

  it('časová osa neexistujícího kontaktu vrací 404', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request(
      '/contacts/00000000-0000-4000-8000-000000000000/timeline',
    );
    expect(response.status).toBe(404);
  });

  it('přehled vrací dlaždice a čas výpočtu', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request('/dashboard?period=30');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.period_days).toBe(30);
    expect(body).toHaveProperty('computed_at');
    expect(Object.keys(body.tiles as Record<string, unknown>)).toContain('click_rate');
  });

  it('neplatné období přehledu vrátí 422', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request('/dashboard?period=365');
    expect(response.status).toBe(422);
  });
});
