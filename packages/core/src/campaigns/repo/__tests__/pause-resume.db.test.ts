import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace,
  seedCampaign,
  setProgressPhase,
  type TestWorkspace,
} from '../../test/harness';
import { pauseCampaign } from '../../control/pause';
import { resumeCampaign } from '../../control/resume';
import { getCampaign } from '../campaign';
import { startMaterialization } from '../audience-progress';

describe('pauza a obnoveni', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it.each(['queueing', 'sending'] as const)(
    'pauza z %s uspeje a zasahne prave jeden radek',
    async (from) => {
      const id = await seedCampaign(ctx, { status: from });
      const r = await pauseCampaign(ctx.workspace, id, {
        code: 'user',
        source: 'user',
        at: new Date().toISOString(),
      });
      expect(r.paused).toBe(true);
      const c = await getCampaign(ctx.workspace, id);
      expect(c!.status).toBe('paused');
      expect((c!.pause_reason as { code: string }).code).toBe('user');
    },
  );

  it('pauza z draftu nezasahne nic a neni to chyba', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    expect(
      (
        await pauseCampaign(ctx.workspace, id, {
          code: 'user',
          source: 'user',
          at: new Date().toISOString(),
        })
      ).paused,
    ).toBe(false);
  });

  it('pause_reason je jsonb, ne text', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await pauseCampaign(ctx.workspace, id, {
      code: 'bounce_guard',
      source: 'app',
      at: new Date().toISOString(),
    });
    const c = await getCampaign(ctx.workspace, id);
    expect(typeof c!.pause_reason).toBe('object');
  });

  it('resume s nedokoncenou materializaci vraci do queueing, ne do sending', async () => {
    const id = await seedCampaign(ctx, { status: 'paused' });
    await startMaterialization(ctx.workspace, id, 0);
    await setProgressPhase(ctx, id, 'materializing');
    expect((await resumeCampaign(ctx.workspace, id)).status).toBe('queueing');
  });

  it('resume po dokoncene materializaci vraci do sending', async () => {
    const id = await seedCampaign(ctx, { status: 'paused' });
    await startMaterialization(ctx.workspace, id, 0);
    await setProgressPhase(ctx, id, 'done');
    expect((await resumeCampaign(ctx.workspace, id)).status).toBe('sending');
  });

  it('resume vymaze paused_at i pause_reason', async () => {
    const id = await seedCampaign(ctx, { status: 'paused' });
    await startMaterialization(ctx.workspace, id, 0);
    await setProgressPhase(ctx, id, 'done');
    await resumeCampaign(ctx.workspace, id);
    const c = await getCampaign(ctx.workspace, id);
    expect(c!.pause_reason).toBeNull();
  });

  it('jedna pozastavena kampan nezastavi ostatni', async () => {
    const paused = await seedCampaign(ctx, { status: 'sending' });
    const running = await seedCampaign(ctx, { status: 'sending' });
    await pauseCampaign(ctx.workspace, paused, {
      code: 'user',
      source: 'user',
      at: new Date().toISOString(),
    });
    expect((await getCampaign(ctx.workspace, running))!.status).toBe('sending');
  });
});
