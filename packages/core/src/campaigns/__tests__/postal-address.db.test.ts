import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { runCampaignPreflight } from '../api/preflight-view';
import { getCampaignFull, readWorkspaceSettings } from '../api/service';
import { readCampaignRootsSource } from '../render-roots';
import { updateWorkspace, getWorkspace } from '../../identity/workspace-service';
import { withWorkspace } from '../../tx';
import { rawSql } from '../repo/raw-sql';
import { seedCampaign, seedContacts, seedList, withTestWorkspace } from '../test/harness';
import type { TestWorkspace } from '../test/harness';

/**
 * POŠTOVNÍ ADRESA ODESÍLATELE, kterou musí obchodní sdělení nést.
 *
 * Výchozí patička sází `{{ workspace.sender_address }}` (`packages/emails/src/document/defaults.ts`),
 * jenže klíč `postal_address` existoval jen v zod schématu a v celém repozitáři
 * ho nikdo nečetl ani nezapisoval. Adresa tedy neměla kde vzniknout a e-mail
 * odcházel s prázdným místem, tiše: render běží se `strictVariables: false`.
 */

let ws: TestWorkspace;

beforeAll(async () => {
  ws = await withTestWorkspace();
}, 300_000);

const OPTS = { asOf: new Date(), timezone: 'Europe/Prague' };

/** Nastaví `compiled_html` tak, aby patička adresu opravdu sázela, nebo ne. */
async function setCompiledHtml(campaignId: string, html: string): Promise<void> {
  await withWorkspace(ws.workspace, (tx) =>
    tx.execute(
      rawSql(`UPDATE campaigns SET compiled_html = $3 WHERE workspace_id = $1 AND id = $2`, [
        ws.workspaceId,
        campaignId,
        html,
      ]),
    ),
  );
}

async function setPostalAddress(value: string): Promise<void> {
  await withWorkspace(ws.workspace, (tx) =>
    updateWorkspace(tx, ws.workspace, { postal_address: value }, 'test'),
  );
}

async function campaignWithFooter(html: string): Promise<string> {
  const list = await seedList(ws, `Adresa-${randomUUID()}`);
  await seedContacts(ws, { count: 2, list });
  const campaign = await seedCampaign(ws, {
    status: 'draft',
    includeLists: [list],
    compiled: true,
  });
  await setCompiledHtml(campaign, html);
  return campaign;
}

async function findingsOf(campaignId: string) {
  const campaign = await getCampaignFull(ws.workspace, campaignId);
  if (campaign === null) throw new Error('kampaň se nenašla');
  return (await runCampaignPreflight(ws.workspace, campaign, OPTS)).findings;
}

const FOOTER_WITH_TAG =
  '<html><body><p>Ahoj</p><p>{{ workspace.sender_address }}</p>' +
  '<a href="{{ unsubscribe_url }}">Odhlásit</a></body></html>';
const FOOTER_WITH_OWN_TEXT =
  '<html><body><p>Ahoj</p><p>Kolo Eshop s.r.o., Nádražní 5</p>' +
  '<a href="{{ unsubscribe_url }}">Odhlásit</a></body></html>';

describe('poštovní adresa odesílatele v nastavení projektu', () => {
  it('uloží se do settings.campaigns a přečte zpátky', async () => {
    await setPostalAddress('Kolo Eshop s.r.o.\nNádražní 5\n110 00 Praha 1');

    const workspace = await withWorkspace(ws.workspace, (tx) => getWorkspace(tx, ws.workspace));
    expect(workspace.postal_address).toBe('Kolo Eshop s.r.o.\nNádražní 5\n110 00 Praha 1');

    const settings = await readWorkspaceSettings(ws.workspace);
    expect(settings.campaigns.postal_address).toContain('Nádražní 5');
  }, 60_000);

  /**
   * Vedle adresy bydlí ve `settings` zkušební režim a prahy doručitelnosti.
   * `jsonb_set` by je nechal být, jenže když klíč `campaigns` ještě neexistuje,
   * mezičlen NEDOPLNÍ a adresu tiše zahodí; přepsání celého sloupce by zase
   * zahodilo sousedy. Test drží obojí najednou.
   */
  it('nepřepíše sousední klíče v settings', async () => {
    await withWorkspace(ws.workspace, (tx) =>
      tx.execute(
        rawSql(
          `UPDATE workspaces
              SET settings = jsonb_build_object('deliverability', jsonb_build_object('bounce_warn_rate', 0.02))
            WHERE id = $1`,
          [ws.workspaceId],
        ),
      ),
    );

    await setPostalAddress('Kolo Eshop s.r.o., Nádražní 5');

    const settings = await readWorkspaceSettings(ws.workspace);
    expect(settings.campaigns.postal_address).toBe('Kolo Eshop s.r.o., Nádražní 5');
    expect(settings.deliverability.bounce_warn_rate).toBe(0.02);
  }, 60_000);

  /**
   * Tentýž výraz čte odesílač ve `StmtCampaignHeader`. Kořeny `campaign`
   * a `workspace` se do `messages.render_data` nesnapshotují, takže tohle je
   * jediná cesta, kterou se adresa do e-mailu dostane.
   */
  it('odesílač i webová podoba zprávy ji najdou přes stejný výraz', async () => {
    await setPostalAddress('Kolo Eshop s.r.o., Nádražní 5');
    const campaign = await campaignWithFooter(FOOTER_WITH_TAG);

    const source = await withWorkspace(ws.workspace, (tx) =>
      readCampaignRootsSource(tx, ws.workspace, campaign),
    );
    expect(source?.postalAddress).toBe('Kolo Eshop s.r.o., Nádražní 5');
    expect(source?.workspaceName).not.toBe('');
  }, 60_000);
});

describe('kontrola před odesláním a chybějící poštovní adresa', () => {
  it('prázdná adresa v šabloně, která ji sází, je VAROVÁNÍ, ne závora', async () => {
    await setPostalAddress('');
    const campaign = await campaignWithFooter(FOOTER_WITH_TAG);

    const findings = await findingsOf(campaign);
    const finding = findings.find((f) => f.code === 'workspace_postal_address_missing');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
    // Závora by zastavila každý projekt, který si nástroj teprve zkouší.
    expect(findings.filter((f) => f.severity === 'error').map((f) => f.code)).not.toContain(
      'workspace_postal_address_missing',
    );
  }, 60_000);

  it('vyplněná adresa varování zhasne', async () => {
    await setPostalAddress('Kolo Eshop s.r.o., Nádražní 5');
    const campaign = await campaignWithFooter(FOOTER_WITH_TAG);

    const codes = (await findingsOf(campaign)).map((f) => f.code);
    expect(codes).not.toContain('workspace_postal_address_missing');
  }, 60_000);

  /** Kdo si adresu napsal do patičky ručně, nemá co řešit. */
  it('šablona bez značky varování nedostane ani s prázdnou adresou', async () => {
    await setPostalAddress('');
    const campaign = await campaignWithFooter(FOOTER_WITH_OWN_TEXT);

    const codes = (await findingsOf(campaign)).map((f) => f.code);
    expect(codes).not.toContain('workspace_postal_address_missing');
  }, 60_000);
});
