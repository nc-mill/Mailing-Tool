import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import {
  seedCampaign,
  seedContact,
  seedMessageEvent,
  seedWorkspace,
} from '../test-support/fixtures';
import { campaignStatsRoutes } from './campaign-stats.routes';
import { createTestApp } from './test-app';

/**
 * Zadavatel klikl v doručeném e-mailu na „Nastavit předvolby" a report ukazoval
 * nulu. Klik se přitom měřil; do `campaign_stats.clicks_*` se ale systémový
 * proklik ZÁMĚRNĚ nezapočítává, aby odhlášení nenafukovalo míru prokliku,
 * takže údaj existoval a nikdo ho nevydával. Tahle cesta ho vydává.
 */
describe('GET /campaigns/{id}/system-link-clicks', () => {
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

  /**
   * `contact_id` je povinné (`ck_message_events__subject`: buď subjekt, nebo
   * vymazaný záznam), takže se ke každé události zakládá skutečný kontakt.
   */
  async function systemClick(
    workspaceId: string,
    campaignId: string,
    at: Date,
    kind: string,
    messageId?: string,
  ) {
    const id = messageId ?? randomUUID();
    await seedMessageEvent(db, {
      workspaceId,
      campaignId,
      messageId: id,
      messageCreatedAt: at,
      contactId: await seedContact(db, workspaceId),
      type: 'click',
      subtype: 'system',
      ts: at,
      metadata: { system_link: kind },
    });
    return id;
  }

  it('počítá příjemce po druzích odkazu, ne načtení stránky', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const at = campaign.audienceBuiltAt;

    const opakovany = await systemClick(ws.workspaceId, campaign.campaignId, at, 'preferences');
    // Tatáž zpráva podruhé: příjemce si předvolby otevřel dvakrát, ale je to
    // pořád jeden člověk. Kdyby se počítaly řádky, vyšly by tu tři.
    await systemClick(ws.workspaceId, campaign.campaignId, at, 'preferences', opakovany);
    await systemClick(ws.workspaceId, campaign.campaignId, at, 'preferences');
    await systemClick(ws.workspaceId, campaign.campaignId, at, 'unsubscribe_page');

    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/system-link-clicks`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      preferences: 2,
      unsubscribe_page: 1,
      webview: 0,
    });
  });

  it('proklik na obsahový odkaz do systémových nepatří', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);

    await seedMessageEvent(db, {
      workspaceId: ws.workspaceId,
      campaignId: campaign.campaignId,
      messageId: randomUUID(),
      messageCreatedAt: campaign.audienceBuiltAt,
      contactId: await seedContact(db, ws.workspaceId),
      type: 'click',
      ts: campaign.audienceBuiltAt,
    });

    expect(
      await (
        await appFor(ws.workspaceId).request(`/campaigns/${campaign.campaignId}/system-link-clicks`)
      ).json(),
    ).toEqual({ preferences: 0, unsubscribe_page: 0, webview: 0 });
  });

  it('kampaň bez jediného prokliku vrací nuly, ne 404', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);

    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/system-link-clicks`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      preferences: 0,
      unsubscribe_page: 0,
      webview: 0,
    });
  });

  it('prokliky z cizího projektu nezapočítá', async () => {
    const owner = await seedWorkspace(db);
    const stranger = await seedWorkspace(db);
    const campaign = await seedCampaign(db, owner.workspaceId);
    await systemClick(owner.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, 'webview');

    expect(
      await (
        await appFor(stranger.workspaceId).request(
          `/campaigns/${campaign.campaignId}/system-link-clicks`,
        )
      ).json(),
    ).toEqual({ preferences: 0, unsubscribe_page: 0, webview: 0 });
  });
});
