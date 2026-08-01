import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace,
  seedCampaign,
  seedOutbox,
  seedEvents,
  type TestWorkspace,
} from '../../test/harness';
import { reconcileDeliveryCounters, reconcileHandoverCounters } from '../counters';
import { getCampaign } from '../campaign';
import { closingStatus } from '../../jobs/watchdog';

describe('citace kampane', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('dotaz nad messages nemeni bounce_count', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 10, failed: 2, skipped: 1 });
    await seedEvents(ctx, { campaignId: id, type: 'bounced_hard', count: 3 });
    await reconcileHandoverCounters(ctx.workspace, id);
    const c = await getCampaign(ctx.workspace, id);
    expect(c!.sent_count).toBe(10);
    expect(c!.bounce_count).toBe(0);
  });

  it('dotaz nad message_events nemeni sent_count', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 10 });
    await seedEvents(ctx, { campaignId: id, type: 'bounced_hard', count: 3 });
    await reconcileDeliveryCounters(ctx.workspace, id);
    const c = await getCampaign(ctx.workspace, id);
    expect(c!.bounce_count).toBe(3);
    expect(c!.sent_count).toBe(0);
  });

  it('dve udalosti bounced_soft pro tutez zpravu zvysi citac o jedna', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 1 });
    await seedEvents(ctx, { campaignId: id, type: 'bounced_soft', count: 2, sameMessage: true });
    await reconcileDeliveryCounters(ctx.workspace, id);
    expect((await getCampaign(ctx.workspace, id))!.bounce_count).toBe(1);
  });

  it('testovaci zpravy se nepocitaji do total_count', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 5, testMessages: 3 });
    await reconcileHandoverCounters(ctx.workspace, id);
    expect((await getCampaign(ctx.workspace, id))!.total_count).toBe(5);
  });
});

describe('uzavreni kampane se pocita jen ze skupiny predani', () => {
  it('vse predano a vse se odrazilo: sent, ne partially_sent', () => {
    expect(
      closingStatus({ total: 100, sent: 100, failed: 0, skipped: 0, partialThreshold: 0.01 }),
    ).toBe('sent');
  });
  it('nic se nepredalo: failed', () => {
    expect(
      closingStatus({ total: 100, sent: 0, failed: 60, skipped: 40, partialThreshold: 0.01 }),
    ).toBe('failed');
  });
  it('nad prahem 1 %: partially_sent', () => {
    expect(
      closingStatus({ total: 100, sent: 95, failed: 3, skipped: 2, partialThreshold: 0.01 }),
    ).toBe('partially_sent');
  });
});
