import { beforeEach, describe, expect, it } from 'vitest';
import { COMPILED_ONLY_ROOTS } from '@mlain/contracts/liquid/grammar';
import {
  withTestWorkspace,
  seedCampaign,
  seedContacts,
  seedList,
  type TestWorkspace,
} from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { ZERO_UUID } from '../../materialize/plan-constants';
import { materializeBatch, type RenderPlan } from '../outbox';
import { startMaterialization } from '../audience-progress';
import { rawSql } from '../raw-sql';
import type { ResolvedTrialSettings } from '../../../providers/trial-mode';

/**
 * Vypnuty zkusebni rezim. Brana `canSendInTrial` je od teto zmeny POVINNY vstup
 * materializace, takze si ji kazdy test musi vyslovne rozhodnout.
 */
const TRIAL_OFF: ResolvedTrialSettings = { trial_mode: false };

/** Sablona bez merge tagu a bez podminek. */
const EMPTY_RENDER_PLAN: RenderPlan = {
  usedPaths: [],
  preparedSchema: { fields: [], presence: [] },
};

describe('materializacni davka', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('vsechny radky maji identicke created_at rovne audience_built_at (invariant I1)', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 1000, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    let cursor = ZERO_UUID;
    for (let i = 0; i < 3; i++) {
      const r = await materializeBatch(ctx.workspace, {
        campaignId: id,
        audienceBuiltAt: audienceBuiltAt!,
        cursor,
        batchSize: 500,
        where: { sql: 'true', params: [] },
        renderPlan: {
          usedPaths: ['contact.first_name'],
          preparedSchema: { fields: ['contact.first_name'], presence: [] },
        },
        sampleContactIds: [],
        releaseAt: null,
        trial: TRIAL_OFF,
      });
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }

    const rows = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(
        rawSql(`SELECT count(DISTINCT created_at)::int AS n FROM messages WHERE campaign_id = $1`, [
          id,
        ]),
      ),
    );
    expect(rows.rows[0]!.n).toBe(1);
    // Vlastni strop: zaseti tisice kontaktu po jednom trva dele nez vychozich 5 s.
  }, 60_000);

  it('dvoji spusteni nevytvori duplicitni radek', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 50, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    const args = {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    };
    await materializeBatch(ctx.workspace, args);
    await materializeBatch(ctx.workspace, args);

    const dup = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `SELECT campaign_id, contact_id, count(*) FROM messages
            WHERE campaign_id = $1 GROUP BY 1,2 HAVING count(*) > 1`,
          [id],
        ),
      ),
    );
    expect(dup.rows).toHaveLength(0);
  });

  it('zapisuje kind = campaign a nikdy prazdny campaign_id', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 5, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ kind: string; campaign_id: string | null }>(
        rawSql(`SELECT kind, campaign_id FROM messages WHERE campaign_id = $1`, [id]),
      ),
    );
    expect(r.rows).toHaveLength(5);
    expect(r.rows.every((x) => x.kind === 'campaign' && x.campaign_id !== null)).toBe(true);
  });

  it('undo okno nastavi next_attempt_at na release_at, ne na audience_built_at', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 3, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    const release = new Date(Date.parse(audienceBuiltAt!) + 60_000).toISOString();
    await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: release,
      trial: TRIAL_OFF,
    });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ next_attempt_at: string }>(
        rawSql(`SELECT next_attempt_at FROM messages WHERE campaign_id = $1 LIMIT 1`, [id]),
      ),
    );
    expect(Date.parse(r.rows[0]!.next_attempt_at) - Date.parse(audienceBuiltAt!)).toBe(60_000);
  });

  it('render_data ma koren _present, jinak by se podminene bloky tise skryly', async () => {
    const list = await seedList(ctx);
    // Dva kontakty: jeden s vyplnenym mestem, druhy se samymi mezerami.
    await seedContacts(ctx, {
      count: 1,
      list,
      attributes: { city: 'Brno' },
      email: 'a@example.cz',
    });
    await seedContacts(ctx, { count: 1, list, attributes: { city: '   ' }, email: 'b@example.cz' });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: {
        usedPaths: ['contact.attr.city'],
        preparedSchema: { fields: ['contact.attr.city'], presence: ['contact.attr.city'] },
      },
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    });

    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ email: string; render_data: Record<string, unknown> }>(
        rawSql(`SELECT email, render_data FROM messages WHERE campaign_id = $1 ORDER BY email`, [
          id,
        ]),
      ),
    );

    // Jmeno korene se bere z kontraktu, ne z konstanty P13: test se schvalne
    // NEPTA tehoz zdroje, ze ktereho ochrana vznikla.
    const root = COMPILED_ONLY_ROOTS[0]!;
    expect(root).toBe('_present');

    const present = (row: { render_data: Record<string, unknown> }) =>
      (row.render_data[root] ?? {}) as Record<string, boolean>;

    expect(present(r.rows[0]!)).toHaveProperty('contact__attr__city');
    expect(present(r.rows[0]!).contact__attr__city).toBe(true);
    // Past prazdneho retezce: same mezery nejsou vyplnena hodnota.
    expect(present(r.rows[1]!).contact__attr__city).toBe(false);
    // Kdyby prepareRenderData nikdo nezavolal, oba radky by mely render_data BEZ
    // _present, kazda podminka by vysla nepravdive a blok by zmizel VZDY.
  });

  it('prilis velka render_data delaji radek skipped, ne nafouknuty outbox', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 1, list, attributes: { bio: 'x'.repeat(9000) } });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    const out = await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: {
        usedPaths: ['contact.attr.bio'],
        preparedSchema: { fields: ['contact.attr.bio'], presence: [] },
      },
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    });

    expect(out.skippedOversize).toBe(1);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; render_data: unknown }>(
        rawSql(`SELECT status, render_data FROM messages WHERE campaign_id = $1`, [id]),
      ),
    );
    expect(r.rows[0]!.status).toBe('skipped');
    expect(r.rows[0]!.render_data).toEqual({});
  });

  it('ukazkovy kontakt se do outboxu nedostane ani pres prazdny filtr publika', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 4, list, sourceRef: 'demo-data:v1' });
    await seedContacts(ctx, { count: 2, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    const out = await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    });
    expect(out.inserted).toBe(2);
  });

  it('kontakt z manifestu vypadne, i kdyz uzivatel znacku v source_ref prepsal', async () => {
    const list = await seedList(ctx);
    const [vlastni] = await seedContacts(ctx, { count: 1, list, sourceRef: 'import:2026-01' });
    await seedContacts(ctx, { count: 2, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    const out = await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [vlastni!],
      releaseAt: null,
      trial: TRIAL_OFF,
    });
    expect(out.inserted).toBe(2);
  });

  it('OB-00 lokalne: dotaz projde planovacem i nad prazdnym publikem', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    const r = await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'false', params: [] },
      renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    });
    expect(r.inserted).toBe(0);
    expect(r.nextCursor).toBeNull();
  });
});
