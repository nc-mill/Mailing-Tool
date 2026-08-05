import { beforeAll, describe, expect, it } from 'vitest';
import { createSystemContext } from '../../identity/context';
import { readCampaignStats } from '../../reports/campaign-stats/read';
import { compareWithStored } from '../../reports/campaign-stats/recompute';
import { withWorkspace } from '../../tx';
import { asMigrator, seedCampaign, seedMessage } from '../test/support/db';
import { refreshCampaignProgress } from '../jobs/refresh-campaign-progress';
import { handlers } from '../jobs/queue-handlers';
import { readSystemLinkClicks, recordSystemLinkClick } from './record';

/**
 * PROKLIK NA SYSTÉMOVÝ ODKAZ, od otevření stránky po číslo v reportu.
 *
 * Test drží tři vlastnosti, kvůli kterým to celé vzniklo:
 *
 *  1. proklik na „Nastavit předvolby" se v datech OBJEVÍ, i když ten odkaz není
 *     v `campaign_links` a nevede přes `/t/c/`,
 *  2. NENAFOUKNE míru prokliku ani počet otevření, protože měří jinou věc,
 *  3. NESPADNE mezi skenery, což by z každého člověka, který si otevře
 *     předvolby, udělalo v reportu robota.
 *
 * Body 2 a 3 jsou to jediné, co by šlo pokazit tiše: nikde by nic nespadlo,
 * jen by report tvrdil jiná čísla. Proto se čtou přes `readCampaignStats`,
 * tedy tutéž cestou jako report, a navíc se porovnávají s nezávislým přepočtem
 * `compareWithStored`.
 */

const AUDIENCE_BUILT_AT = new Date(Math.floor((Date.now() - 3_600_000) / 1000) * 1000);

async function seedContact(workspaceId: string, email: string): Promise<string> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO contacts (workspace_id, email) VALUES ($1, $2) RETURNING id`,
    [workspaceId, email],
  );
  return rows[0]!.id;
}

async function drainQueue(name: keyof typeof handlers): Promise<number> {
  const { rows } = await asMigrator().query<{ id: string; data: unknown }>(
    `SELECT id, data FROM pgboss.job WHERE name = $1 AND state = 'created' ORDER BY created_on`,
    [name],
  );
  if (rows.length === 0) return 0;

  await handlers[name](
    rows.map((row) => ({ id: row.id, name, data: row.data as Record<string, unknown> })),
  );
  await asMigrator().query(
    `UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE id = ANY($1::uuid[])`,
    [rows.map((row) => row.id)],
  );
  return rows.length;
}

describe('proklik na systémový odkaz v patičce', () => {
  let workspaceId: string;
  let campaignId: string;
  let messageId: string;
  let contactId: string;

  beforeAll(async () => {
    ({ workspaceId, campaignId } = await seedCampaign(AUDIENCE_BUILT_AT));
    contactId = await seedContact(workspaceId, 'prijemce@example.cz');
    messageId = await seedMessage({
      workspaceId,
      campaignId,
      contactId,
      createdAt: AUDIENCE_BUILT_AT,
      sentAt: new Date(AUDIENCE_BUILT_AT.getTime() + 60_000),
    });
  }, 300_000);

  it('připíše kampani proklik na předvolby a odhlašovací stránku', async () => {
    const preferences = await recordSystemLinkClick({
      workspaceId,
      messageId,
      messageCreatedAt: AUDIENCE_BUILT_AT,
      contactId,
      kind: 'preferences',
    });
    expect(preferences).toEqual({ campaignId, recorded: true });

    const unsubscribePage = await recordSystemLinkClick({
      workspaceId,
      messageId,
      messageCreatedAt: AUDIENCE_BUILT_AT,
      contactId,
      kind: 'unsubscribe_page',
    });
    expect(unsubscribePage).toEqual({ campaignId, recorded: true });

    const { rows } = await asMigrator().query<{
      type: string;
      subtype: string;
      link_id: string | null;
      system_link: string;
    }>(
      `SELECT type, subtype, link_id, metadata ->> 'system_link' AS system_link
         FROM message_events
        WHERE campaign_id = $1
        ORDER BY metadata ->> 'system_link'`,
      [campaignId],
    );
    expect(rows).toEqual([
      { type: 'click', subtype: 'system', link_id: null, system_link: 'preferences' },
      { type: 'click', subtype: 'system', link_id: null, system_link: 'unsubscribe_page' },
    ]);
  });

  it('opakované načtení stránky druhý řádek nevyrobí', async () => {
    const again = await recordSystemLinkClick({
      workspaceId,
      messageId,
      messageCreatedAt: AUDIENCE_BUILT_AT,
      contactId,
      kind: 'preferences',
    });
    expect(again).toEqual({ campaignId, recorded: false });

    const { rows } = await asMigrator().query<{ count: string }>(
      `SELECT count(*) AS count FROM message_events
        WHERE campaign_id = $1 AND metadata ->> 'system_link' = 'preferences'`,
      [campaignId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('nezvedne míru prokliku ani počet skenerů a souhrn zůstane bez driftu', async () => {
    expect(await drainQueue('tracking.process_engagement')).toBeGreaterThanOrEqual(0);
    await refreshCampaignProgress({ workspaceId, campaignId, audienceBuiltAt: AUDIENCE_BUILT_AT });

    const ctx = createSystemContext(workspaceId, 'test.report');
    const stats = await withWorkspace(ctx, (tx) => readCampaignStats(tx, ctx, campaignId));

    expect(stats.counts.clicksTotal).toBe(0);
    expect(stats.counts.clicksUnique).toBe(0);
    expect(stats.counts.clicksUniqueHuman).toBe(0);
    expect(stats.counts.clicksScanner).toBe(0);
    expect(stats.counts.opensTotal).toBe(0);

    // Nezávislý přepočet z message_events musí dát totéž. Kdyby systémový
    // proklik spadl do jednoho vzorce a do druhého ne, ukáže se to tady.
    const drift = await withWorkspace(ctx, (tx) => compareWithStored(tx, ctx, campaignId));
    expect(drift.differences).toEqual([]);
  });

  it('spočítá prokliky po druzích odkazu', async () => {
    await expect(readSystemLinkClicks({ workspaceId, campaignId })).resolves.toEqual({
      preferences: 1,
      unsubscribe_page: 1,
      webview: 0,
    });
  });

  it('proklik z tokenu na neexistující zprávu se nikam nepřipíše', async () => {
    const result = await recordSystemLinkClick({
      workspaceId,
      messageId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6099',
      messageCreatedAt: AUDIENCE_BUILT_AT,
      contactId,
      kind: 'webview',
    });
    expect(result).toEqual({ campaignId: null, recorded: false });
  });
});
