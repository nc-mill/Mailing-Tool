import { beforeEach, describe, expect, it } from 'vitest';
// ODCHYLKA OD PLÁNU, JEN V CESTÁCH. Plán importoval harness z `../../../testing/harness`
// a doménové moduly přes `../../../../../core/src/campaigns/...`. Ani jedna cesta
// v repozitáři neexistuje; harness leží v `campaigns/test/harness`. Importovaný kód
// je tentýž.
import { withTestWorkspace, seedCampaign, type TestWorkspace } from '../../test/harness';
import { claimDueCampaigns, markScheduleMissed, getCampaign } from '../campaign';

describe('planovac', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('vezme kampan, jejiz cas nastal a je v catch-up okne', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 10 });
    expect(await claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 })).toContain(id);
  });

  it('nevezme kampan, jejiz cas jeste nenastal', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: -30 });
    expect(await claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 })).not.toContain(
      id,
    );
  });

  it('kampan starsi nez catch-up okno prejde do schedule_missed a NEODESLE se', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 9 * 60 });
    await markScheduleMissed(ctx.workspace, { catchupHours: 6 });
    expect((await getCampaign(ctx.workspace, id))!.status).toBe('schedule_missed');
    expect(await claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 })).not.toContain(
      id,
    );
  });

  it('dva soubezne behy planovace nevydaji tutez kampan dvakrat', async () => {
    await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 5 });
    const [a, b] = await Promise.all([
      claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 }),
      claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 }),
    ]);
    expect(a.length + b.length).toBeLessThanOrEqual(2);
    expect(new Set([...a, ...b]).size).toBe(Math.max(a.length, b.length));
  });
});
