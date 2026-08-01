import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, type TestWorkspace } from '../../test/harness';
import { transitionStatus, getCampaign, bumpRevision } from '../campaign';

describe('prechody stavu kampane', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('prechod z povoleneho stavu vrati radek', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const row = await transitionStatus(ctx.workspace, {
      campaignId: id,
      to: 'queueing',
      from: ['draft', 'scheduled', 'schedule_missed'],
    });
    expect(row?.status).toBe('queueing');
  });

  it('prechod z nepovoleneho stavu nevrati nic a stav se nezmeni', async () => {
    const id = await seedCampaign(ctx, { status: 'sent' });
    const row = await transitionStatus(ctx.workspace, {
      campaignId: id,
      to: 'queueing',
      from: ['draft'],
    });
    expect(row).toBeNull();
    expect((await getCampaign(ctx.workspace, id))?.status).toBe('sent');
  });

  it('dva soubezne prechody: prave jeden uspeje', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const both = await Promise.all([
      transitionStatus(ctx.workspace, { campaignId: id, to: 'queueing', from: ['draft'] }),
      transitionStatus(ctx.workspace, { campaignId: id, to: 'queueing', from: ['draft'] }),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it('kampan z ciziho projektu neni videt', async () => {
    const other = await withTestWorkspace();
    const id = await seedCampaign(other, { status: 'draft' });
    expect(await getCampaign(ctx.workspace, id)).toBeNull();
  });

  it('zmena obsahu ve stavu draft inkrementuje revision', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const before = (await getCampaign(ctx.workspace, id))!.revision;
    await bumpRevision(ctx.workspace, id);
    expect((await getCampaign(ctx.workspace, id))!.revision).toBe(before + 1);
  });
});
