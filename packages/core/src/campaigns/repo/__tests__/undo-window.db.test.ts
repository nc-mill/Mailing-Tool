/**
 * Okno na zrušení odeslání (rozhodnutí D12) při opakovaném odeslání.
 *
 * Nález z integrace HTTP vrstvy: cesta `POST /send` volá `startMaterialization` přímo
 * a když zařazení úlohy selže, vrátí přechod zpátky a odpoví 503. `release_at` ale
 * v řádku zůstane. Dokud se držel přes `COALESCE`, druhý pokus o odeslání převzal
 * okno, které už uplynulo: `next_attempt_at` šlo do minulosti, sender vzal zprávy
 * okamžitě a uživatel neměl na zrušení ani sekundu. Nespadlo přitom nic, takže to
 * musí hlídat test, ne úvaha.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, type TestWorkspace } from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { startMaterialization } from '../audience-progress';
import { rawSql } from '../raw-sql';

/** Vrátí kampaň do draftu přesně tak, jak to po neúspěšném zařazení úlohy dělá API. */
async function revertToDraft(ctx: TestWorkspace, campaignId: string): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(`UPDATE campaigns SET status = 'draft' WHERE id = $1 AND workspace_id = $2`, [
        campaignId,
        ctx.workspaceId,
      ]),
    ),
  );
}

async function readRow(
  ctx: TestWorkspace,
  campaignId: string,
): Promise<{ audience_built_at: string | null; release_at: string | null }> {
  const r = await withWorkspace(ctx.workspace, (tx) =>
    tx.execute<{ audience_built_at: string | null; release_at: string | null }>(
      rawSql(`SELECT audience_built_at, release_at FROM campaigns WHERE id = $1`, [campaignId]),
    ),
  );
  return r.rows[0]!;
}

describe('undo okno pri opakovanem odeslani', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('prvni zabrani kampane okno zalozi', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const { releaseAt, audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 60);
    expect(releaseAt).not.toBeNull();
    expect(Date.parse(releaseAt!) - Date.parse(audienceBuiltAt!)).toBe(60_000);
  });

  it('uplynule okno se po neuspesnem odeslani pocita ZNOVU, ne prevezme', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await startMaterialization(ctx.workspace, id, 60);

    // Neúspěšné zařazení úlohy: API vrátí stav zpátky, časy v řádku zůstanou.
    await revertToDraft(ctx, id);
    // Posuneme okno do minulosti, ať test nemusí čekat minutu.
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(`UPDATE campaigns SET release_at = now() - interval '5 minutes' WHERE id = $1`, [
          id,
        ]),
      ),
    );

    const second = await startMaterialization(ctx.workspace, id, 60);

    expect(second.claimed).toBe(true);
    // Tohle je jádro věci: okno musí být v budoucnosti, jinak sender bere zprávy hned.
    expect(Date.parse(second.releaseAt!)).toBeGreaterThan(Date.now());
  });

  it('audience_built_at se NEPREPOCITAVA, drzi ho invariant I1', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const first = await startMaterialization(ctx.workspace, id, 60);
    await revertToDraft(ctx, id);
    const second = await startMaterialization(ctx.workspace, id, 60);
    expect(second.audienceBuiltAt).toBe(first.audienceBuiltAt);
  });

  it('jeste bezici okno se neposouva, opakovani ho nesmi prodluzovat', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const first = await startMaterialization(ctx.workspace, id, 60);
    await revertToDraft(ctx, id);
    const second = await startMaterialization(ctx.workspace, id, 60);
    expect(second.releaseAt).toBe(first.releaseAt);
  });

  it('nulove okno znamena zadne release_at, zpravy jdou hned', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const { releaseAt } = await startMaterialization(ctx.workspace, id, 0);
    expect(releaseAt).toBeNull();
    expect((await readRow(ctx, id)).release_at).toBeNull();
  });

  it('obnova po padu workeru druhou vetvi okno nemeni', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const first = await startMaterialization(ctx.workspace, id, 60);
    // Kampaň zůstává v queueing, tedy přesně stav po pádu workeru.
    const resumed = await startMaterialization(ctx.workspace, id, 60);
    expect(resumed.claimed).toBe(false);
    expect(resumed.releaseAt).toBe(first.releaseAt);
    expect(resumed.audienceBuiltAt).toBe(first.audienceBuiltAt);
  });
});
