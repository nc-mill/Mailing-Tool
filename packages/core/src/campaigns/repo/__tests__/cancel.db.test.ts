import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace,
  seedCampaign,
  seedOutbox,
  type TestWorkspace,
} from '../../test/harness';
import { cancelCampaign } from '../../control/cancel';
import { findOrphanedPending } from '../outbox';
import { withWorkspace } from '../../../tx';
import { getCampaign } from '../campaign';
import { rawSql } from '../raw-sql';

describe('zruseni kampane', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('50 000 zprav, 12 000 sent: sent zustava, zbytek krome claimed je skipped', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 12_000, pending: 37_950, claimed: 50 });
    await cancelCampaign(ctx.workspace, id, { reason: 'user' });

    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; n: number }>(
        rawSql(
          `SELECT status, count(*)::int AS n FROM messages WHERE campaign_id = $1 GROUP BY status`,
          [id],
        ),
      ),
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.status, x.n]));
    expect(by.sent).toBe(12_000);
    expect(by.skipped).toBe(37_950);
    expect(by.claimed).toBe(50);
    expect((await getCampaign(ctx.workspace, id))!.status).toBe('cancelled');
    // ODCHYLKA OD PLÁNU, VYNUCENÁ MĚŘENÍM. Plán u tohohle scénáře žádný časový strop
    // neuváděl, takže platil výchozích 5 s a scénář by nedoběhl nikdy. Ani 300 s
    // nestačilo: padesát tisíc kontaktů a padesát tisíc zpráv znamená přes milion
    // zápisů do indexů (contacts jich má dvanáct, messages jedenáct) a na Docker
    // Desktopu je to jednotky minut. Zeslabovat tvrzení scénáře kvůli tomu nejde,
    // objem JE to, co se zkouší, takže se posouvá hodinová ručička, ne měřítko.
  }, 900_000);

  it('zrusene zpravy maji error_code campaign_cancelled, nikdy failed', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 500, claimed: 50 });
    await cancelCampaign(ctx.workspace, id, { reason: 'user' });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(
        rawSql(
          `SELECT count(*)::int AS n FROM messages
                                WHERE campaign_id = $1 AND status = 'failed'`,
          [id],
        ),
      ),
    );
    expect(r.rows[0]!.n).toBe(0);
  });

  it('uklid bezi po davkach, dokud UPDATE vraci nenulovy pocet', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 25_000 });
    const r = await cancelCampaign(ctx.workspace, id, { reason: 'user' });
    expect(r.cleanedBatches).toBeGreaterThanOrEqual(3);
  }, 600_000);

  it('po zruseni neexistuje ani jedna pending zprava, jinak by branila odpojeni oddilu', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 1000 });
    await cancelCampaign(ctx.workspace, id, { reason: 'user' });
    expect(await findOrphanedPending(ctx.workspace)).toHaveLength(0);
  });

  it('findOrphanedPending najde pending v kampani v koncovem stavu', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 3 });
    // Kampaň se přepne do koncového stavu BEZ úklidu outboxu, tedy přesně do té
    // poruchy, kterou má hlídka najít. `seedCampaign` se stavem `cancelled` by
    // nestačil: `seedOutbox` potřebuje vyplnit `audience_built_at` a zprávy se
    // do zrušené kampaně zakládají stejně.
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(`UPDATE campaigns SET status = 'cancelled' WHERE id = $1 AND workspace_id = $2`, [
          id,
          ctx.workspaceId,
        ]),
      ),
    );
    const r = await findOrphanedPending(ctx.workspace);
    expect(r[0]).toMatchObject({ campaign_id: id, orphaned_pending: 3 });
  });
});
