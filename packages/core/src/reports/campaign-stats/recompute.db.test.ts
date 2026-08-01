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
  seedCampaignStats,
  seedContact,
  seedMessageEvent,
  seedWorkspace,
} from '../test-support/fixtures';
import { compareWithStored, recomputeCampaignCounts } from './recompute';

describe('recomputeCampaignCounts', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedFullCampaign() {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    // tři zprávy: jedna ověřeně otevřená a prokliknutá, jedna jen Apple, jedna beze všeho
    const cases = [
      { mask: 1, human: true, click: true },
      { mask: 2, human: false, click: false },
      { mask: 0, human: false, click: false },
    ];
    for (const item of cases) {
      const contact = await seedContact(db, ws.workspaceId);
      const messageId = randomUUID();
      await db.pool.query(
        `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
         VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, $5)`,
        [messageId, ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
      );
      if (item.mask !== 0) {
        await db.pool.query(
          `INSERT INTO message_engagement
             (message_id, created_at, workspace_id, campaign_id, contact_id,
              first_open_at, first_human_open_at, open_count, human_open_count, open_class_mask,
              first_click_at, first_human_click_at, click_count, human_click_count)
           VALUES ($1, $2, $3, $4, $5, $2, $6, 1, $7, $8, $9, $10, $11, $11)`,
          [
            messageId,
            campaign.audienceBuiltAt,
            ws.workspaceId,
            campaign.campaignId,
            contact,
            item.human ? campaign.audienceBuiltAt : null,
            item.human ? 1 : 0,
            item.mask,
            item.click ? campaign.audienceBuiltAt : null,
            item.click ? campaign.audienceBuiltAt : null,
            item.click ? 1 : 0,
          ],
        );
      }
    }
    return { ws, campaign };
  }

  it('spočítá agregace od nuly z engagementu a událostí', async () => {
    const { ws, campaign } = await seedFullCampaign();
    const counts = await recomputeCampaignCounts(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(counts.materialized).toBe(3);
    expect(counts.sent).toBe(3);
    expect(counts.opensUnique).toBe(2);
    expect(counts.opensUniqueHuman).toBe(1);
    expect(counts.opensUniqueApple).toBe(1);
    expect(counts.clicksUniqueHuman).toBe(1);
  });

  it('nahlásí rozdíl mezi uloženou agregací a přepočtem', async () => {
    const { ws, campaign } = await seedFullCampaign();
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: 3,
      sent: 3,
      opens_unique: 99,
    });
    const drift = await compareWithStored(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(drift.matches).toBe(false);
    expect(drift.differences).toContainEqual({ key: 'opensUnique', stored: 99, recomputed: 2 });
  });

  it('spočítá doručení, oba odrazy a stížnost pod jmény ze schématu (R19)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const plan: Array<[string, string]> = [
      ['delivered', 'a@example.cz'],
      ['bounced_hard', 'b@example.cz'],
      ['bounced_soft', 'c@example.cz'],
      ['complained', 'd@example.cz'],
    ];
    for (const [type, email] of plan) {
      const contact = await seedContact(db, ws.workspaceId, { email });
      const messageId = randomUUID();
      await db.pool.query(
        `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
         VALUES ($1, $2, $3, $4, $5, 'sent', $6, $6)`,
        [messageId, ws.workspaceId, campaign.campaignId, contact, email, campaign.audienceBuiltAt],
      );
      await seedMessageEvent(db, {
        workspaceId: ws.workspaceId,
        campaignId: campaign.campaignId,
        messageId,
        messageCreatedAt: campaign.audienceBuiltAt,
        contactId: contact,
        type,
        recipient: email,
      });
    }

    const counts = await recomputeCampaignCounts(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    // Se starým slovníkem (`bounce`, `complaint`) by tu byly samé nuly
    // a žádný dotaz by přitom nespadl. To je celý smysl tohohle testu.
    expect(counts.delivered).toBe(1);
    expect(counts.bouncedHard).toBe(1);
    expect(counts.bouncedSoft).toBe(1);
    expect(counts.complained).toBe(1);
  });

  it('u správně vedené agregace nehlásí žádný rozdíl', async () => {
    const { ws, campaign } = await seedFullCampaign();
    const tx = createTestTx(db);
    const ctx = testContext(ws.workspaceId);
    const counts = await recomputeCampaignCounts(tx, ctx, campaign.campaignId);
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: counts.materialized,
      sent: counts.sent,
      failed: counts.failed,
      skipped: counts.skipped,
      delivered: counts.delivered,
      bounced_hard: counts.bouncedHard,
      bounced_soft: counts.bouncedSoft,
      complained: counts.complained,
      unsubscribed: counts.unsubscribed,
      opens_total: counts.opensTotal,
      opens_unique: counts.opensUnique,
      opens_unique_human: counts.opensUniqueHuman,
      opens_unique_apple: counts.opensUniqueApple,
      clicks_total: counts.clicksTotal,
      clicks_unique: counts.clicksUnique,
      clicks_unique_human: counts.clicksUniqueHuman,
      clicks_scanner: counts.clicksScanner,
    });
    const drift = await compareWithStored(tx, ctx, campaign.campaignId);
    expect(drift.differences).toEqual([]);
    expect(drift.matches).toBe(true);
  });
});
