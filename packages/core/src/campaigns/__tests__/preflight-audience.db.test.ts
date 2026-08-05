import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { runCampaignPreflight } from '../api/preflight-view';
import { getCampaignFull } from '../api/service';
import { withWorkspace } from '../../tx';
import { rawSql } from '../repo/raw-sql';
import { seedCampaign, seedContacts, seedList, withTestWorkspace } from '../test/harness';
import type { TestWorkspace } from '../test/harness';

/**
 * PRÁZDNÉ PUBLIKUM MUSÍ ŘÍKAT PRAVDU.
 *
 * Kampaň na seznam, ve kterém jsou lidé, ale všichni čekají na potvrzení, hlásila
 * „Publikum je prázdné. Vyberte alespoň jeden seznam nebo segment." Seznam přitom
 * vybraný byl a lidi v něm měl, takže rada nešla splnit a uživatel neměl podle čeho
 * poznat, co se stalo. Test hlídá, že se ty dva případy rozlišují a že se počet
 * čekajících v nálezu doopravdy objeví.
 */

let ws: TestWorkspace;

beforeAll(async () => {
  ws = await withTestWorkspace();
}, 300_000);

const OPTS = { asOf: new Date(), timezone: 'Europe/Prague' };

/** Přepne přihlášení seznamu na čekající. Harness je zakládá rovnou potvrzená. */
async function setPending(listId: string): Promise<void> {
  await withWorkspace(ws.workspace, (tx) =>
    tx.execute(
      rawSql(
        `UPDATE list_subscriptions SET status = 'pending'
          WHERE workspace_id = $1 AND list_id = $2`,
        [ws.workspaceId, listId],
      ),
    ),
  );
}

async function findingsOf(campaignId: string): Promise<{ code: string; params?: unknown }[]> {
  const campaign = await getCampaignFull(ws.workspace, campaignId);
  if (campaign === null) throw new Error('kampaň se nenašla');
  const view = await runCampaignPreflight(ws.workspace, campaign, OPTS);
  return view.findings;
}

describe('nález u prázdného publika', () => {
  it('seznam samých čekajících hlásí, kolik jich čeká, ne „vyberte seznam"', async () => {
    const list = await seedList(ws, `Novinky-${randomUUID()}`);
    await seedContacts(ws, { count: 3, list });
    await setPending(list);

    const campaign = await seedCampaign(ws, { status: 'draft', includeLists: [list] });
    const findings = await findingsOf(campaign);

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'campaign_audience_all_pending',
        params: { pending: 3 },
      }),
    );
    // Původní kód se u téhle příčiny objevit nesmí, jinak by uživatel dostal obě rady naráz.
    expect(findings.map((f) => f.code)).not.toContain('campaign_audience_empty');
  }, 60_000);

  it('seznam bez jediného člověka hlásí dál původní prázdné publikum', async () => {
    const list = await seedList(ws, `Prazdny-${randomUUID()}`);
    const campaign = await seedCampaign(ws, { status: 'draft', includeLists: [list] });

    const findings = await findingsOf(campaign);

    expect(findings.map((f) => f.code)).toContain('campaign_audience_empty');
    expect(findings.map((f) => f.code)).not.toContain('campaign_audience_all_pending');
  }, 60_000);

  it('kampaň bez vybraného seznamu hlásí dál původní prázdné publikum', async () => {
    const campaign = await seedCampaign(ws, { status: 'draft', includeLists: [] });

    const findings = await findingsOf(campaign);

    expect(findings.map((f) => f.code)).toContain('campaign_audience_empty');
  }, 60_000);

  it('potvrzené publikum nehlásí ani jeden z obou nálezů', async () => {
    const list = await seedList(ws, `Potvrzeny-${randomUUID()}`);
    await seedContacts(ws, { count: 2, list });

    const campaign = await seedCampaign(ws, { status: 'draft', includeLists: [list] });
    const findings = await findingsOf(campaign);

    expect(findings.map((f) => f.code)).not.toContain('campaign_audience_empty');
    expect(findings.map((f) => f.code)).not.toContain('campaign_audience_all_pending');
  }, 60_000);
});
