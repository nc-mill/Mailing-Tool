import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { runCampaignPreflight } from '../api/preflight-view';
import { getCampaignFull } from '../api/service';
import { withWorkspace } from '../../tx';
import { rawSql } from '../repo/raw-sql';
import {
  footerOnlyDesign,
  seedCampaign,
  seedContacts,
  seedList,
  withTestWorkspace,
} from '../test/harness';
import type { TestWorkspace } from '../test/harness';

/**
 * PRÁZDNÝ E-MAIL SE NESMÍ ODESLAT.
 *
 * Vada z instalace: kampaň „Test kampaň (kopie)" odešla na tři skutečné adresy
 * a do schránky dorazil e-mail, ve kterém nebylo nic než patička (Odhlásit se
 * z odběru, Nastavit předvolby, Zobrazit v prohlížeči). V databázi to sedělo
 * přesně tak, jak to odešlo: `compiled_html` mělo 4529 znaků, `compiled_text`
 * 166 a dokument měl jednu sekci s jediným potomkem typu `footer`.
 *
 * Kontrola před odesláním to pustila, protože se ptala jen na `compiled_html`
 * (bylo, patička se kompiluje jako každý jiný blok) a na odkaz k odhlášení
 * (byl, právě z té patičky). Testy drží, že se to znovu nestane, a zároveň že
 * se kampaň BEZ obsahu pozná od kampaně s obsahem PRÁZDNÝM.
 */

let ws: TestWorkspace;

beforeAll(async () => {
  ws = await withTestWorkspace();
}, 300_000);

const OPTS = { asOf: new Date(), timezone: 'Europe/Prague' };

async function viewOf(campaignId: string) {
  const campaign = await getCampaignFull(ws.workspace, campaignId);
  if (campaign === null) throw new Error('kampaň se nenašla');
  return runCampaignPreflight(ws.workspace, campaign, OPTS);
}

/** Kampaň bez dokumentu. `seedCampaign` ho zakládá vždycky, tady se odstraní. */
async function dropDesign(campaignId: string): Promise<void> {
  await withWorkspace(ws.workspace, (tx) =>
    tx.execute(
      rawSql(`UPDATE campaigns SET design = NULL WHERE workspace_id = $1 AND id = $2`, [
        ws.workspaceId,
        campaignId,
      ]),
    ),
  );
}

describe('obsah kampaně v kontrole před odesláním', () => {
  it('kampaň, ve které není nic než patička, neprojde', async () => {
    const list = await seedList(ws, `Obsah-${randomUUID()}`);
    await seedContacts(ws, { count: 2, list });
    const campaign = await seedCampaign(ws, {
      status: 'draft',
      includeLists: [list],
      design: footerOnlyDesign(),
      compiled: true,
    });

    const view = await viewOf(campaign);
    const codes = view.findings.map((f) => f.code);

    expect(codes).toContain('campaign_content_empty');
    expect(view.findings.find((f) => f.code === 'campaign_content_empty')?.severity).toBe('error');
    expect(view.can_send).toBe(false);
    // Kampaň zkompilovaná je, takže tenhle nález by mířil vedle.
    expect(codes).not.toContain('campaign_not_compiled');
  }, 60_000);

  it('kampaň bez dokumentu hlásí chybějící obsah, ne prázdný', async () => {
    const list = await seedList(ws, `Bez-${randomUUID()}`);
    await seedContacts(ws, { count: 2, list });
    const campaign = await seedCampaign(ws, { status: 'draft', includeLists: [list] });
    await dropDesign(campaign);

    const codes = (await viewOf(campaign)).findings.map((f) => f.code);

    expect(codes).toContain('campaign_content_missing');
    expect(codes).not.toContain('campaign_content_empty');
  }, 60_000);

  it('jediný textový blok stačí, aby obsah prošel', async () => {
    const list = await seedList(ws, `Text-${randomUUID()}`);
    await seedContacts(ws, { count: 2, list });
    const campaign = await seedCampaign(ws, {
      status: 'draft',
      includeLists: [list],
      compiled: true,
    });

    const codes = (await viewOf(campaign)).findings.map((f) => f.code);

    expect(codes).not.toContain('campaign_content_empty');
    expect(codes).not.toContain('campaign_content_missing');
  }, 60_000);

  it('příznaky v odpovědi kampaně říkají o obsahu pravdu', async () => {
    const empty = await seedCampaign(ws, { status: 'draft', design: footerOnlyDesign() });
    const full = await seedCampaign(ws, { status: 'draft' });

    const emptyRow = await getCampaignFull(ws.workspace, empty);
    const fullRow = await getCampaignFull(ws.workspace, full);

    // Dokument MÁ obě kampaně, obsah jen jedna z nich. Právě na tomhle rozdílu
    // vada stála: `has_content` znamenalo „design není NULL" a lhalo.
    expect(emptyRow?.has_design).toBe(true);
    expect(emptyRow?.content_block_count).toBe(0);
    expect(fullRow?.has_design).toBe(true);
    expect(fullRow?.content_block_count).toBe(1);
  }, 60_000);

  it('obsah zanořený ve sloupcích se počítá taky', async () => {
    const nested = {
      schemaVersion: 1,
      meta: { name: 'Kampaň', previewText: 'Náhled', language: 'cs' },
      theme: (footerOnlyDesign() as { theme: unknown }).theme,
      blocks: [
        {
          id: 'b_000000000001',
          type: 'section',
          props: (footerOnlyDesign() as { blocks: Array<{ props: unknown }> }).blocks[0]!.props,
          children: [
            {
              id: 'b_000000000002',
              type: 'columns',
              props: {
                layout: '1-1',
                gap: 16,
                stackOnMobile: true,
                stackOrder: 'normal',
                verticalAlign: 'top',
              },
              children: [
                {
                  id: 'b_000000000003',
                  type: 'column',
                  props: {
                    padding: { top: 0, right: 0, bottom: 0, left: 0 },
                    backgroundColor: null,
                    borderRadius: 0,
                  },
                  children: [
                    {
                      id: 'b_000000000004',
                      type: 'heading',
                      props: { content: [{ t: 'p', children: [{ t: 's', v: 'Nadpis' }] }] },
                    },
                  ],
                },
              ],
            },
            { id: 'b_000000000099', type: 'footer', props: {} },
          ],
        },
      ],
    };

    const campaign = await seedCampaign(ws, { status: 'draft', design: nested });
    const row = await getCampaignFull(ws.workspace, campaign);

    expect(row?.content_block_count).toBe(1);
  }, 60_000);
});
