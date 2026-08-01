import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import { seedCampaign, seedWorkspace } from '../test-support/fixtures';
import { readCampaignLinks } from './links';

describe('readCampaignLinks', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedLink(
    workspaceId: string,
    campaignId: string,
    position: number,
    url: string,
    label: string,
    stats: { total: number; unique: number; human: number } | null,
  ) {
    const linkId = randomUUID();
    await db.pool.query(
      `INSERT INTO campaign_links (id, workspace_id, campaign_id, url, position, label)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [linkId, workspaceId, campaignId, url, position, label],
    );
    if (stats) {
      await db.pool.query(
        `INSERT INTO campaign_link_stats (workspace_id, campaign_id, link_id, clicks_total, clicks_unique, clicks_human)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [workspaceId, campaignId, linkId, stats.total, stats.unique, stats.human],
      );
    }
    return linkId;
  }

  it('řadí odkazy sestupně podle ověřených prokliků a počítá podíl', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedLink(
      ws.workspaceId,
      campaign.campaignId,
      0,
      'https://x.cz/nabidka',
      'Zobrazit nabídku',
      {
        total: 142,
        unique: 112,
        human: 142,
      },
    );
    await seedLink(
      ws.workspaceId,
      campaign.campaignId,
      1,
      'https://x.cz/kola',
      'Kola do 20 000 Kč',
      {
        total: 48,
        unique: 41,
        human: 48,
      },
    );
    const links = await readCampaignLinks(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(links.map((l) => l.label)).toEqual(['Zobrazit nabídku', 'Kola do 20 000 Kč']);
    expect(links[0]?.share).toBeCloseTo(142 / 190, 10);
    expect(links[0]?.clicksUnique).toBe(112);
  });

  it('vrací i odkaz, na který nikdo neklikl, s nulami', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedLink(ws.workspaceId, campaign.campaignId, 0, 'https://x.cz/a', 'A', null);
    const links = await readCampaignLinks(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ clicksHuman: 0, share: 0 });
  });

  it('označí dva odkazy se stejnou adresou, aby se v reportu nepletly', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedLink(ws.workspaceId, campaign.campaignId, 0, 'https://x.cz/a', 'Obrázek', {
      total: 5,
      unique: 5,
      human: 5,
    });
    await seedLink(ws.workspaceId, campaign.campaignId, 1, 'https://x.cz/a', 'Text pod obrázkem', {
      total: 3,
      unique: 3,
      human: 3,
    });
    const links = await readCampaignLinks(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(links.every((l) => l.duplicateUrl)).toBe(true);
  });
});
