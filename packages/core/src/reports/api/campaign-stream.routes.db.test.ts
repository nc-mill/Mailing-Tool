import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, type TestDatabase } from '../test-support/db';
import { seedCampaign, seedCampaignStats, seedWorkspace } from '../test-support/fixtures';
import { campaignStreamRoutes, streamLimiter } from './campaign-stream.routes';
import { createTestApp, userContext } from './test-app';

async function readFirstEvent(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('odpověď nemá tělo');
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe('GET /campaigns/{id}/stream', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  function appFor(workspaceId: string, actorId = 'ac1e0000-0000-4000-8000-000000000001') {
    // Aktér typu `user` je to, co v provozu nastaví middleware z P04
    // po ověření relace. Strop spojení se počítá právě na něj.
    return createTestApp(userContext(workspaceId, actorId), createTestTx(db), [
      campaignStreamRoutes as never,
    ]);
  }

  it('pošle hlavičky, které nepustí buffering proxy', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 10 });
    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/stream`,
      { headers: { Accept: 'text/event-stream' } },
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    await response.body?.cancel();
  });

  it('první zpráva nese aktuální snímek, ne přírůstek', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 12043,
      delivered: 11890,
    });
    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/stream`,
      { headers: { Accept: 'text/event-stream' } },
    );
    const chunk = await readFirstEvent(response);
    expect(chunk).toContain('event: stats');
    expect(chunk).toContain('"sent":12043');
  });

  it('třetí spojení téže relace dostane 503, aby klient přešel na dotazování (kritérium 99)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 1 });
    const app = appFor(ws.workspaceId, 'ac1e0000-0000-4000-8000-000000000002');
    const open: Response[] = [];
    for (let i = 0; i < 2; i += 1) {
      open.push(
        await app.request(`/campaigns/${campaign.campaignId}/stream`, {
          headers: { Accept: 'text/event-stream' },
        }),
      );
    }
    const third = await app.request(`/campaigns/${campaign.campaignId}/stream`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(third.status).toBe(503);
    for (const response of open) await response.body?.cancel();
  });

  it('po ukončení spojení se uvolní slot', async () => {
    const before = streamLimiter.count;
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 1 });
    const response = await appFor(ws.workspaceId, 'ac1e0000-0000-4000-8000-000000000003').request(
      `/campaigns/${campaign.campaignId}/stream`,
      {
        headers: { Accept: 'text/event-stream' },
      },
    );
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(streamLimiter.count).toBe(before);
  });
});
