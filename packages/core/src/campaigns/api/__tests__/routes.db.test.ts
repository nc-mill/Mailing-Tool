import { OpenAPIHono } from '@hono/zod-openapi';
import { PgBoss } from 'pg-boss';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../errors/api-error';
import type { WorkspaceContext } from '../../../tx';
import {
  migratorClient,
  seedCampaign,
  seedContacts,
  seedList,
  seedOutbox,
  seedProvider,
  withTestWorkspace,
  type TestWorkspace,
} from '../../test/harness';
import { registerCampaignRoutes } from '../campaigns.routes';
import type { CampaignsEnv } from '../index';
import { registerProviderRoutes } from '../../../providers/api/providers.routes';

/**
 * Cesty veřejného API domény kampaní proti skutečné databázi.
 *
 * Testovací obal dělá v malém totéž, co v provozu kostra aplikace z P04
 * (`apps/web/src/lib/api/app.ts`), kterou `packages/core` importovat nesmí:
 * doplní proměnnou `auth` a přeloží `ApiError` na stavový kód z registru.
 * Bez něj by `not_found` z domény skončil jako 500 a test by měřil chybějící
 * middleware, ne chování cesty.
 */
function appFor(ctx: WorkspaceContext): OpenAPIHono<CampaignsEnv> {
  // Router se typuje prostředím domény. Bez generiky má `c.set` typ `never`
  // a nastavení proměnné `auth` se nepřeloží.
  const app = new OpenAPIHono<CampaignsEnv>({
    defaultHook: (result) => {
      if (!result.success) throw new ApiError('validation_failed', { errors: [] });
    },
  });
  app.use('*', async (c, next) => {
    c.set('auth', { ctx, label: 'test' });
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        {
          code: error.code,
          params: error.params ?? null,
          findings: error.findings ?? null,
          request_id: 'test',
        },
        error.status as 400,
      );
    }
    throw error;
  });
  registerCampaignRoutes(app);
  registerProviderRoutes(app);
  return app;
}

/** Fronty, do kterých tahle vrstva zařazuje úlohy. `job.name` má cizí klíč na `queue.name`. */
const QUEUES_USED = ['campaign.materialize'];

let pgBossReady = false;

async function installPgBoss(): Promise<void> {
  if (pgBossReady) return;
  const migrator = migratorClient();
  const connectionString = (migrator.options as { connectionString?: string }).connectionString;
  if (!connectionString) throw new Error('migrátorský pool nemá connectionString');

  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    supervise: false,
    schedule: false,
  });
  await boss.start();
  for (const name of QUEUES_USED) await boss.createQueue(name);
  await boss.stop({ graceful: false });
  await migrator.query(`GRANT USAGE ON SCHEMA pgboss TO mlain_app`);
  await migrator.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO mlain_app`,
  );
  pgBossReady = true;
}

/**
 * Šablona z harnessu má `compiled_html` bez odkazu na odhlášení, takže by preflight
 * vždycky hlásil `campaign_no_unsubscribe`. Doplňuje se tady, aby testy odesílání
 * měřily přechod stavu, ne chybějící odkaz.
 */
async function makeSendable(campaignId: string): Promise<void> {
  await migratorClient().query(
    `UPDATE campaigns SET compiled_html = '<p>ok <a href="{{ unsubscribe_url }}">odhlásit</a></p>'
      WHERE id = $1`,
    [campaignId],
  );
}

describe('REST API kampaní', () => {
  let ctx: TestWorkspace;

  beforeAll(async () => {
    await installPgBoss();
  }, 300_000);

  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  async function sendableCampaign(status = 'draft'): Promise<{ id: string; recipients: number }> {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 3, list });
    const providerId = await seedProvider(ctx, { status: 'ready' });
    const id = await seedCampaign(ctx, {
      status,
      includeLists: [list],
      compiled: true,
      providerId,
    });
    await makeSendable(id);
    return { id, recipients: 3 };
  }

  it('GET /campaigns vrací kampaně projektu', async () => {
    await seedCampaign(ctx, { status: 'draft' });
    const res = await appFor(ctx.workspace).request('/campaigns');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('GET /preflight vrací vždy 200, i když jsou nálezy blokující', async () => {
    const id = await seedCampaign(ctx, { status: 'draft', subject: '' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/preflight`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { can_send: boolean; findings: Array<{ code: string }> };
    expect(body.can_send).toBe(false);
    expect(body.findings.map((f) => f.code)).toContain('campaign_subject_missing');
  });

  it('kontrolní seznam nese pojmenovaný rozpad publika, ne souhrn', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 2, list });
    await seedContacts(ctx, { count: 1, list, status: 'unsubscribed' });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list], compiled: true });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/preflight`);
    const body = (await res.json()) as {
      audience_estimate: number;
      breakdown: Record<string, number>;
    };
    expect(body.audience_estimate).toBe(2);
    expect(body.breakdown.excluded_unsubscribed).toBe(1);
    // Součet bran plus výsledek se rovná vstupnímu počtu. Na tom stojí věta
    // v kontrolním seznamu a nesmí se rozejít ani o jednoho člověka.
    const excluded = Object.entries(body.breakdown)
      .filter(([k]) => k.startsWith('excluded_') || k === 'duplicates_removed')
      .reduce((sum, [, v]) => sum + v, 0);
    expect(excluded + body.breakdown.eligible!).toBe(body.breakdown.raw);
  });

  it('POST /send při blokujícím nálezu vrací 422 se všemi nálezy', async () => {
    const id = await seedCampaign(ctx, { status: 'draft', subject: '' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_recipient_count: 0 }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; findings: Array<{ code: string }> };
    expect(body.code).toBe('campaign_not_sendable');
    expect(body.findings.length).toBeGreaterThanOrEqual(2);
  });

  it('confirm_recipient_count mimo toleranci 1 % vrací campaign_audience_changed', async () => {
    const { id } = await sendableCampaign();
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_recipient_count: 500 }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('campaign_audience_changed');
  });

  it('POST /send na odeslanou kampaň vrací 409 invalid_state_transition', async () => {
    const { id, recipients } = await sendableCampaign('sent');
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_recipient_count: recipients }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('invalid_state_transition');
  });

  it('dvě souběžná POST /send: jedno 202, druhé 409', async () => {
    const { id, recipients } = await sendableCampaign();
    const app = appFor(ctx.workspace);
    const call = () =>
      app.request(`/campaigns/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_recipient_count: recipients }),
      });
    const [a, b] = await Promise.all([call(), call()]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
  });

  it('PATCH předmětu ve stavu scheduled vrací 409 campaign_locked', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: -60 });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Nový' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('campaign_locked');
  });

  it('PATCH jména ve stavu scheduled projde', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: -60 });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jiné jméno' }),
    });
    expect(res.status).toBe(200);
  });

  it('GET /messages vrací u každé zprávy id i created_at', async () => {
    const id = await seedCampaign(ctx, { status: 'sent' });
    await seedOutbox(ctx, { campaignId: id, sent: 2 });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/messages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toHaveProperty('id');
    expect(body.data[0]).toHaveProperty('created_at');
  });

  it('POST /undo po vypršení okna vrací 409 campaign_undo_window_expired', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/undo`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('campaign_undo_window_expired');
  });

  it('POST /pause pozastaví odesílanou kampaň a uloží důvod', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/pause`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; pause_reason: { code: string } };
    expect(body.status).toBe('paused');
    expect(body.pause_reason.code).toBe('user');
  });

  it('POST /resume u kampaně zastavené Amazonem vrací 422', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await migratorClient().query(
      `UPDATE campaigns SET status = 'paused',
          pause_reason = '{"code":"provider_blocked","source":"app","at":"2026-08-01T00:00:00.000Z"}'::jsonb
        WHERE id = $1`,
      [id],
    );
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/resume`, { method: 'POST' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('provider_sending_paused');
  });

  it('GET /progress ukazuje čítače a zbývající okno na zrušení', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 1, pending: 2 });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/progress`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counters: Record<string, number>; status: string };
    expect(body.status).toBe('sending');
    expect(body.counters).toHaveProperty('pending');
  });

  it('neexistující kampaň je 404, ne 500', async () => {
    const res = await appFor(ctx.workspace).request(
      '/campaigns/00000000-0000-4000-8000-000000000000',
    );
    expect(res.status).toBe(404);
  });
});

describe('prahy doručitelnosti jdou nastavit jen přísněji', () => {
  let ctx: TestWorkspace;

  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('GET vrací nastavení projektu i stropy instalace', async () => {
    const res = await appFor(ctx.workspace).request('/settings/deliverability');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { limits: Record<string, number> };
    expect(body.limits.DELIVERABILITY_BOUNCE_GUARD_RATE).toBeGreaterThan(0);
  });

  it('přísnější hodnota se uloží', async () => {
    const res = await appFor(ctx.workspace).request('/settings/deliverability', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounce_guard_rate: 0.05 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).settings.bounce_guard_rate).toBe(0.05);
  });

  it('volnější hodnota se odmítne s 422, ne tiše ořízne', async () => {
    const res = await appFor(ctx.workspace).request('/settings/deliverability', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounce_guard_rate: 0.5 }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('validation_failed');
  });

  it('vyšší podlaha guard_min_sent se taky odmítne, protože brzda by zabrala později', async () => {
    const res = await appFor(ctx.workspace).request('/settings/deliverability', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guard_min_sent: 999_999 }),
    });
    expect(res.status).toBe(422);
  });
});
