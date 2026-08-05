import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedContact, seedWebEvent, seedWorkspace } from '../test-support/fixtures';
import { readCampaignWebActivity } from './campaign';

const HOUR = 60 * 60 * 1000;

describe('readCampaignWebActivity', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  /** Proklik v kampani tak, jak ho do osy zapisuje job zapojení. */
  async function seedClick(
    workspaceId: string,
    campaignId: string,
    contactId: string,
    at: Date,
    clickClass = 'human',
  ): Promise<void> {
    await seedWebEvent(db, {
      workspaceId,
      name: 'email_clicked',
      source: 'email',
      occurredAt: at,
      contactId,
      properties: { campaign_id: campaignId, link_id: randomUUID(), click_class: clickClass },
    });
  }

  it('spojí proklik v kampani s návštěvou webu do okna a spočítá, co si prohlédli', async () => {
    const ws = await seedWorkspace(db);
    const startedAt = new Date(Date.now() - 6 * HOUR);
    const campaign = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: startedAt });
    const contact = await seedContact(db, ws.workspaceId, { email: 'jana@example.cz' });
    const session = randomUUID();

    await seedClick(ws.workspaceId, campaign.campaignId, contact, new Date(Date.now() - 5 * HOUR));
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 4 * HOUR),
      contactId: contact,
      sessionId: session,
      page: { url: 'https://shop.cz/vyprodej', path: '/vyprodej' },
    });
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 3 * HOUR),
      contactId: contact,
      sessionId: session,
      page: { url: 'https://shop.cz/vyprodej', path: '/vyprodej' },
    });
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'product_viewed',
      occurredAt: new Date(Date.now() - 3 * HOUR),
      contactId: contact,
      sessionId: session,
      properties: { sku: 'DEMO-1' },
    });

    const result = await readCampaignWebActivity(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );

    expect(result.clickedContacts).toBe(1);
    expect(result.visitorContacts).toBe(1);
    expect(result.pageViews).toBe(2);
    expect(result.otherEvents).toBe(1);
    expect(result.sessions).toBe(1);
    expect(result.pages).toEqual([{ path: '/vyprodej', views: 2, visitors: 1 }]);
    expect(result.events).toEqual([{ name: 'product_viewed', count: 1, visitors: 1 }]);
    expect(result.visitors[0]).toMatchObject({ email: 'jana@example.cz', pageViews: 2, events: 3 });
  });

  /**
   * Jádro pravidla připsání. Návštěva po vypršení okna k téhle kampani
   * nepatří: mezi prokliknutím a ní se mohlo stát cokoliv jiného a produkt
   * nemá čím doložit, že za ni může právě tenhle e-mail.
   */
  it('návštěvu mimo okno kampani nepřipíše', async () => {
    const ws = await seedWorkspace(db);
    const startedAt = new Date(Date.now() - 40 * HOUR);
    const campaign = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: startedAt });
    const contact = await seedContact(db, ws.workspaceId);

    await seedClick(ws.workspaceId, campaign.campaignId, contact, new Date(Date.now() - 39 * HOUR));
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 2 * HOUR),
      contactId: contact,
      page: { path: '/pozde' },
    });

    const result = await readCampaignWebActivity(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );

    expect(result.clickedContacts).toBe(1);
    expect(result.visitorContacts).toBe(0);
    expect(result.pageViews).toBe(0);
  });

  it('proklik robota se za návštěvníka nepovažuje', async () => {
    const ws = await seedWorkspace(db);
    const startedAt = new Date(Date.now() - 6 * HOUR);
    const campaign = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: startedAt });
    const contact = await seedContact(db, ws.workspaceId);

    await seedClick(
      ws.workspaceId,
      campaign.campaignId,
      contact,
      new Date(Date.now() - 5 * HOUR),
      'scanner',
    );
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 4 * HOUR),
      contactId: contact,
      page: { path: '/vyprodej' },
    });

    const result = await readCampaignWebActivity(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );

    expect(result.clickedContacts).toBe(0);
    expect(result.visitorContacts).toBe(0);
  });

  it('smazaný kontakt se mezi návštěvníky nevrátí', async () => {
    const ws = await seedWorkspace(db);
    const startedAt = new Date(Date.now() - 6 * HOUR);
    const campaign = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: startedAt });
    const contact = await seedContact(db, ws.workspaceId);

    await seedClick(ws.workspaceId, campaign.campaignId, contact, new Date(Date.now() - 5 * HOUR));
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 4 * HOUR),
      contactId: contact,
      page: { path: '/vyprodej' },
    });
    await db.pool.query(`UPDATE contacts SET deleted_at = now() WHERE id = $1`, [contact]);

    const result = await readCampaignWebActivity(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );

    expect(result.clickedContacts).toBe(0);
    expect(result.visitorContacts).toBe(0);
    expect(result.visitors).toEqual([]);
  });

  it('proklik z jiné kampaně se do téhle nepřelije', async () => {
    const ws = await seedWorkspace(db);
    const startedAt = new Date(Date.now() - 6 * HOUR);
    const mine = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: startedAt });
    const other = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: startedAt });
    const contact = await seedContact(db, ws.workspaceId);

    await seedClick(ws.workspaceId, other.campaignId, contact, new Date(Date.now() - 5 * HOUR));
    await seedWebEvent(db, {
      workspaceId: ws.workspaceId,
      name: 'page_view',
      occurredAt: new Date(Date.now() - 4 * HOUR),
      contactId: contact,
      page: { path: '/vyprodej' },
    });

    const result = await readCampaignWebActivity(
      createTestTx(db),
      testContext(ws.workspaceId),
      mine.campaignId,
    );
    expect(result.clickedContacts).toBe(0);
    expect(result.visitorContacts).toBe(0);
  });

  it('neodeslaná kampaň vrací prázdno, ne chybu', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'draft' });
    await db.pool.query(`UPDATE campaigns SET started_at = NULL WHERE id = $1`, [
      campaign.campaignId,
    ]);

    const result = await readCampaignWebActivity(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.startedAt).toBeNull();
    expect(result.visitorContacts).toBe(0);
  });

  it('neznámá kampaň končí chybou not_found', async () => {
    const ws = await seedWorkspace(db);
    await expect(
      readCampaignWebActivity(createTestTx(db), testContext(ws.workspaceId), randomUUID()),
    ).rejects.toThrow();
  });
});
