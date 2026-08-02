import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace,
  seedCampaign,
  seedContacts,
  seedList,
  type TestWorkspace,
} from '../../test/harness';
import { ZERO_UUID } from '../../materialize/plan-constants';
import { resumeTarget, shouldRunFinish } from '../../materialize/finish';
import { startMaterialization, finishMaterialization, getProgress } from '../audience-progress';
import { materializeBatch, type RenderPlan } from '../outbox';
import { getCampaign } from '../campaign';
import type { ResolvedTrialSettings } from '../../../providers/trial-mode';

/**
 * Vypnuty zkusebni rezim. Brana `canSendInTrial` je od teto zmeny POVINNY vstup
 * materializace, takze si ji kazdy test musi vyslovne rozhodnout.
 */
const TRIAL_OFF: ResolvedTrialSettings = { trial_mode: false };

const EMPTY_RENDER_PLAN: RenderPlan = {
  usedPaths: [],
  preparedSchema: { fields: [], presence: [] },
};

describe('krok 3 materializace', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('nastavi sending, total_count z messages a audience_size z postupu', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 7, list });
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
    await finishMaterialization(ctx.workspace, id, audienceBuiltAt!);

    const c = await getCampaign(ctx.workspace, id);
    expect(c!.status).toBe('sending');
    expect(c!.total_count).toBe(7);
    expect((await getProgress(ctx.workspace, id))!.phase).toBe('done');
  });

  it('total_count pocita jen radky s created_at = audience_built_at', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 3, list });
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
    await finishMaterialization(ctx.workspace, id, audienceBuiltAt!);
    expect((await getCampaign(ctx.workspace, id))!.total_count).toBe(3);
  });

  it('opakovane volani je no-op, protoze podminka je status = queueing', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await finishMaterialization(ctx.workspace, id, audienceBuiltAt!);
    const second = await finishMaterialization(ctx.workspace, id, audienceBuiltAt!);
    expect(second).toBe(false);
  });

  it('krok 3 bezi jen po dokoncene smycce a resume mirí podle faze', () => {
    expect(shouldRunFinish('completed')).toBe(true);
    for (const outcome of ['paused', 'cancelled', 'timeout', 'aborted'] as const) {
      expect(shouldRunFinish(outcome)).toBe(false);
    }
    expect(resumeTarget('materializing')).toBe('queueing');
    expect(resumeTarget('collecting')).toBe('queueing');
    expect(resumeTarget('done')).toBe('sending');
  });
});
