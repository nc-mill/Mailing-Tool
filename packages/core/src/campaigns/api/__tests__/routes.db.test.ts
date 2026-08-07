import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import { PgBoss } from 'pg-boss';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../errors/api-error';
import type { WorkspaceContext } from '../../../tx';
import {
  migratorClient,
  seedCampaign,
  seedContacts,
  seedEvents,
  seedList,
  seedOutbox,
  seedProvider,
  withTestWorkspace,
  type TestWorkspace,
} from '../../test/harness';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import { getFieldCatalog } from '../../../contacts/fields/catalog';
import { createTemplate, saveDesign } from '../../../templates/service';
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

/**
 * Dokument šablony s patičkou (odhlašovací odkaz) a s jedním sledovaným odkazem.
 * Bez patičky hlásí preflight `campaign_no_unsubscribe`, bez odkazu by nešlo
 * ukázat, že se `campaign_links` opravdu plní.
 */
function templateDocument(options: { withLink?: boolean } = {}): unknown {
  const paragraph =
    options.withLink === false
      ? { t: 'p', children: [{ t: 's', v: 'Dobrý den' }] }
      : {
          t: 'p',
          children: [
            { t: 's', v: 'Mrkni na ' },
            {
              t: 'a',
              href: 'https://example.cz/akce',
              trackable: true,
              children: [{ t: 's', v: 'akci' }],
            },
          ],
        };
  return {
    schemaVersion: 1,
    meta: { name: 'Jarní novinky', previewText: 'Vítejte', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [
          {
            id: 'b_000000000002',
            type: 'text',
            props: { ...blockDefaults('text'), content: [paragraph] },
          },
          { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') },
        ],
      },
    ],
  };
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

  /**
   * Zlatá cesta obsahu: výběr šablony zkopíruje dokument do `campaigns.design`,
   * kompilace z něj udělá `compiled_html` a teprve pak kontrolní seznam pustí odeslání.
   *
   * Je to test celé té cesty přes veřejné API, protože každý ze tří kroků zvlášť
   * projde i tehdy, když je řetěz přerušený: `PATCH` uloží `template_id` a obsah
   * nechá prázdný, kompilace nemá co dělat a preflight hlásí `campaign_not_compiled`
   * navždy. Přesně tak to v repozitáři vypadalo.
   */
  async function seedTemplateWithLink(): Promise<string> {
    const fields = await getFieldCatalog(ctx.workspace);
    const row = await createTemplate(
      { ctx: ctx.workspace, fields, userId: ctx.userId },
      { name: 'Jarní novinky', document: templateDocument() as Document },
    );
    return row.id;
  }

  /**
   * Jméno dokumentu uloženého jako obsah kampaně. `null`, když kampaň obsah nemá.
   *
   * Čte se pod migrátorskou rolí, tedy mimo RLS: kontrolní čtení nesmí ovlivnit
   * tatáž politika, kterou používá testovaný kód. Chybějící řádek se hlásí
   * VÝJIMKOU se jménem kampaně, ne `undefined`: kdyby test četl přes hranici
   * databáze nebo projektu, má to říct rovnou, ne až selháním na hodnotě.
   */
  async function designName(campaignId: string): Promise<string | null> {
    const r = await migratorClient().query<{ design: { meta: { name: string } } | null }>(
      `SELECT design FROM campaigns WHERE id = $1`,
      [campaignId],
    );
    if (r.rows.length !== 1) {
      throw new Error(
        `Kampaň ${campaignId} v testovací databázi není (${r.rows.length} řádků). ` +
          'Zápis a kontrolní čtení míří do různých databází.',
      );
    }
    return r.rows[0]!.design?.meta.name ?? null;
  }

  /**
   * Obsah šablony se do kampaně dostal. Tvrdí se to PŘED tím, než na tom stojí
   * cokoliv dalšího.
   *
   * Existuje kvůli konkrétnímu proběhlému zmatku: když se dokument nezkopíruje,
   * kampaň se zkompiluje z výchozího dokumentu harnessu, ten žádný odkaz nemá
   * a testy pak padají až na `link_count` nebo na stavovém kódu odeslání, tedy
   * na hodnotách, ze kterých příčina není vidět. Tady spadnou na příčině.
   */
  async function expectTemplateApplied(campaignId: string): Promise<void> {
    expect(await designName(campaignId)).toBe('Jarní novinky');
  }

  it('PATCH vyplni obsah z sablony, kdyz kampan jeste zadny nema', async () => {
    const templateId = await seedTemplateWithLink();
    const app = appFor(ctx.workspace);
    // Kampaň se zakládá cestou API, ne harnessem: čerstvá kampaň má `design` NULL
    // a právě tenhle stav se tady testuje.
    const created = await app.request('/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jarní novinky' }),
    });
    const campaign = (await created.json()) as {
      id: string;
      has_design: boolean;
      has_content: boolean;
    };
    expect(campaign.has_design).toBe(false);
    expect(campaign.has_content).toBe(false);

    const res = await app.request(`/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).has_design).toBe(true);
    expect(await designName(campaign.id)).toBe('Jarní novinky');
  });

  it('PATCH hotovy obsah NEPREPISE, i kdyz se sablona meni', async () => {
    const templateId = await seedTemplateWithLink();
    // Harness zakládá kampaň s vlastním obsahem, tedy přesně ten případ, kdy by
    // přepis znamenal ztrátu rozdělané práce jediným uložením nastavení.
    const id = await seedCampaign(ctx, { status: 'draft' });
    expect(await designName(id)).toBe('Kampaň');

    const res = await appFor(ctx.workspace).request(`/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    expect(res.status).toBe(200);
    // `template_id` se zapsalo, obsah zůstal. Přepis vlastní jen apply-template.
    expect((await res.json()).template_id).toBe(templateId);
    expect(await designName(id)).toBe('Kampaň');
  });

  it('POST /apply-template obsah zkopiruje, zkompiluje a preflight pusti odeslani', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 3, list });
    const providerId = await seedProvider(ctx, { status: 'ready' });
    const templateId = await seedTemplateWithLink();
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list], providerId });
    const app = appFor(ctx.workspace);

    const res = await app.request(`/campaigns/${id}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      overwritten: boolean;
      compiled: { link_count: number; has_unsubscribe_link: boolean };
    };
    // Kampaň z harnessu obsah měla, takže o něj tímhle krokem přišla a UI to má říct.
    expect(body.overwritten).toBe(true);
    await expectTemplateApplied(id);
    expect(body.compiled.link_count).toBe(1);
    expect(body.compiled.has_unsubscribe_link).toBe(true);

    const pre = await app.request(`/campaigns/${id}/preflight`);
    const view = (await pre.json()) as {
      can_send: boolean;
      findings: Array<{ code: string; severity: string }>;
    };
    expect(view.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(view.can_send).toBe(true);
  });

  it('POST /apply-template na prazdnou kampan hlasi overwritten false', async () => {
    const templateId = await seedTemplateWithLink();
    const app = appFor(ctx.workspace);
    const created = await app.request('/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jarní novinky', subject: 'Jaro' }),
    });
    const campaign = (await created.json()) as { id: string };

    const res = await app.request(`/campaigns/${campaign.id}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).overwritten).toBe(false);
  });

  /**
   * Regrese na chybu, kterou nahlásil uživatel: kampaň ho pustila do editoru,
   * ale při návratu dostal 422 `campaign_subject_missing`, přestože se obsah
   * zkopíroval. Chyba mluvila o kompilaci, ne o převzetí obsahu.
   *
   * Předmět se vyplňuje v kroku ZA obsahem, takže na něm převzetí obsahu viset
   * nesmí. Kompilace se odloží (`compiled: null`) a chybějící předmět hlásí
   * kontrola před odesláním, která kampaň odeslat nepustí.
   */
  it('POST /apply-template bez predmetu obsah prevezme, jen nezkompiluje', async () => {
    const templateId = await seedTemplateWithLink();
    const id = await seedCampaign(ctx, { status: 'draft', subject: '' });
    const app = appFor(ctx.workspace);

    const res = await app.request(`/campaigns/${id}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overwritten: boolean; compiled: unknown };
    expect(body.compiled).toBeNull();
    // Obsah je v kampani, o práci z editoru se nepřijde.
    await expectTemplateApplied(id);

    // Odeslat se přesto nedá: předmět chybí a kontrola to říká nahlas.
    const pre = await app.request(`/campaigns/${id}/preflight`);
    const view = (await pre.json()) as {
      can_send: boolean;
      findings: Array<{ code: string; severity: string }>;
    };
    expect(view.findings.map((f) => f.code)).toContain('campaign_subject_missing');
    expect(view.can_send).toBe(false);
  });

  it('POST /apply-template na odesilajici kampan vraci 409, obsah zustava', async () => {
    const templateId = await seedTemplateWithLink();
    const id = await seedCampaign(ctx, { status: 'sending' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('campaign_locked');
    expect(await designName(id)).toBe('Kampaň');
  });

  it('POST /apply-template s neznamou sablonou vraci 404 a obsah nemeni', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: '2f1e5c8a-3b7d-4e41-9a02-0000000000ff' }),
    });
    expect(res.status).toBe(404);
    expect(await designName(id)).toBe('Kampaň');
  });

  it('POST /compile ulozi telo, metadata i odkazy a preflight pak pusti odeslani', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 3, list });
    const providerId = await seedProvider(ctx, { status: 'ready' });
    const templateId = await seedTemplateWithLink();
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list], providerId });
    const app = appFor(ctx.workspace);

    // Obsah se do kampaně dostává použitím šablony, ne klíčem v částečném zápisu.
    await app.request(`/campaigns/${id}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    await expectTemplateApplied(id);

    const compiled = await app.request(`/campaigns/${id}/compile`, { method: 'POST' });
    expect(compiled.status).toBe(200);
    const result = (await compiled.json()) as {
      link_count: number;
      has_unsubscribe_link: boolean;
    };
    expect(result.has_unsubscribe_link).toBe(true);
    expect(result.link_count).toBe(1);

    const stored = await migratorClient().query<{ compiled_html: string | null; n: string }>(
      `SELECT c.compiled_html, (SELECT count(*)::text FROM campaign_links l
                                 WHERE l.campaign_id = c.id) AS n
         FROM campaigns c WHERE c.id = $1`,
      [id],
    );
    expect(stored.rows[0]!.compiled_html).toContain('unsubscribe_url');
    expect(stored.rows[0]!.n).toBe('1');

    const pre = await app.request(`/campaigns/${id}/preflight`);
    const view = (await pre.json()) as {
      can_send: boolean;
      findings: Array<{ code: string; severity: string }>;
    };
    expect(view.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(view.can_send).toBe(true);
  });

  it('POST /compile na kampan bez sablony vraci 422, ne prazdne telo', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await migratorClient().query(`UPDATE campaigns SET design = NULL WHERE id = $1`, [id]);
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/compile`, { method: 'POST' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('campaign_not_compiled');
  });

  it('POST /compile na odesilajici kampan vraci 409: compile_meta je nemenna (D18)', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/compile`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('campaign_locked');
  });

  it('POST /send po zmene obsahu bez rekompilace vraci contract_mismatch (D17)', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 3, list });
    const providerId = await seedProvider(ctx, { status: 'ready' });
    const templateId = await seedTemplateWithLink();
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list], providerId });
    const app = appFor(ctx.workspace);

    await app.request(`/campaigns/${id}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
    await expectTemplateApplied(id);

    // Obsah se změní ZA ZÁDY uložené compile_meta: odkaz zmizí, takže čerstvá
    // kompilace vydá jiný seznam odkazů. Bez kontroly z D17 by kampaň odešla
    // a report kliků by zůstal prázdný, aniž by cokoli spadlo.
    await migratorClient().query(`UPDATE campaigns SET design = $2::jsonb WHERE id = $1`, [
      id,
      JSON.stringify(templateDocument({ withLink: false })),
    ]);

    const res = await app.request(`/campaigns/${id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_recipient_count: 3 }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('contract_mismatch');
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

  /**
   * REGRESE: obnova po pauze neměla vrácení stavu, jaké má odeslání.
   *
   * Když se materializace nezařadí, `resumeCampaign` už kampaň přepnul do
   * `queueing`. Z toho stavu ji nikdo nezvedne: hlídač uzavírá běžící kampaně,
   * zaseknuté `queueing` neoživuje. Bez vrácení skončila obnova jako 500 a kampaň
   * zůstala navždy na „připravuje se".
   *
   * Selhání zařazení se vyrábí tak, jak k němu dojde v provozu: fronta má politiku
   * `exclusive` a nad touž kampaní už jedna úloha visí, takže `onMerged: 'fail'`
   * vyhodí `JobNotEnqueuedError`. Politika se nastavuje jen pro tenhle test,
   * protože testovací obal zakládá fronty bez ní.
   */
  it('POST /resume vrátí kampaň do paused, když se materializace nezařadí', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    const pauseReason = {
      code: 'user',
      source: 'user',
      at: '2026-08-01T00:00:00.000Z',
    };
    await migratorClient().query(
      `UPDATE campaigns SET status = 'paused', paused_at = '2026-08-01T00:00:00.000Z',
          pause_reason = $2::jsonb
        WHERE id = $1`,
      [id, JSON.stringify(pauseReason)],
    );
    // Nedokončená materializace, aby `resumeCampaign` mířil do `queueing`, ne do `sending`.
    await migratorClient().query(
      `INSERT INTO campaign_audience_progress (campaign_id, workspace_id, phase)
         VALUES ($1, $2, 'collecting')
       ON CONFLICT (campaign_id) DO UPDATE SET phase = 'collecting'`,
      [id, ctx.workspaceId],
    );
    await migratorClient().query(
      `UPDATE pgboss.queue SET policy = 'exclusive' WHERE name = 'campaign.materialize'`,
    );
    await migratorClient().query(
      `INSERT INTO pgboss.job (name, data, singleton_key, policy)
         VALUES ('campaign.materialize', '{}'::jsonb, $1, 'exclusive')`,
      [`campaign.materialize:${id}`],
    );

    try {
      const res = await appFor(ctx.workspace).request(`/campaigns/${id}/resume`, {
        method: 'POST',
      });
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('service_unavailable');
    } finally {
      await migratorClient().query(
        `UPDATE pgboss.queue SET policy = 'standard' WHERE name = 'campaign.materialize'`,
      );
    }

    const after = await migratorClient().query<{
      status: string;
      paused_at: Date | null;
      pause_reason: { code?: string } | null;
    }>(`SELECT status, paused_at, pause_reason FROM campaigns WHERE id = $1`, [id]);
    expect(after.rows[0]?.status).toBe('paused');
    expect(after.rows[0]?.pause_reason?.code).toBe('user');
    expect(after.rows[0]?.paused_at).not.toBeNull();
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

  /**
   * REGRESE NA NÁLEZ, KVŮLI KTERÉMU SE UKAZATEL NEHÝBAL.
   *
   * Sloupce `campaigns.*_count` plní jedině cronová úloha `campaign.watchdog`,
   * a to jednou za patnáct sekund. Dokud z nich průběh četl, ukazoval mezi
   * dvěma tiky pořád tutéž hodnotu; u kampaně na tři adresy to znamenalo nuly
   * až do konce a pak rovnou hotovo. Test drží kampaň s nulami v uložených
   * čítačích a odeslanými zprávami v outboxu: odpověď musí říct pravdu
   * z outboxu, ne uloženou nulu.
   */
  it('GET /progress čte čítače živě z outboxu, ne z uložených sloupců kampaně', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 2, pending: 1 });
    await migratorClient().query(
      `UPDATE campaigns SET total_count = 0, sent_count = 0 WHERE id = $1`,
      [id],
    );

    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/progress`);
    const body = (await res.json()) as { counters: Record<string, number> };
    expect(body.counters.sent).toBe(2);
    expect(body.counters.total).toBe(3);
    expect(body.counters.pending).toBe(1);
  });

  /**
   * Nula a „neměříme" jsou dvě různé věci. Doručenost se dozvíme jedině
   * z událostí od poskytovatele a ve vývoji nedorazí ani jedna, protože odběr
   * u Amazonu se nepotvrdí na `localhost`. Bez tohohle příznaku by obrazovka
   * ukazovala trvalou nulu, jako by nikomu nic nedošlo.
   */
  it('GET /progress přiznává, že o doručení zatím nic neví', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 3 });

    const before = (await (
      await appFor(ctx.workspace).request(`/campaigns/${id}/progress`)
    ).json()) as { delivery_events_seen: boolean; counters: Record<string, number> };
    expect(before.delivery_events_seen).toBe(false);

    await seedEvents(ctx, { campaignId: id, type: 'delivered', count: 2 });

    const after = (await (
      await appFor(ctx.workspace).request(`/campaigns/${id}/progress`)
    ).json()) as { delivery_events_seen: boolean; counters: Record<string, number> };
    expect(after.delivery_events_seen).toBe(true);
    expect(after.counters.delivered).toBe(2);
  });

  it('GET /progress říká, jestli je hotovo, aby obrazovka přestala obnovovat', async () => {
    const id = await seedCampaign(ctx, { status: 'sent' });
    await seedOutbox(ctx, { campaignId: id, sent: 3 });
    const body = (await (
      await appFor(ctx.workspace).request(`/campaigns/${id}/progress`)
    ).json()) as { finished: boolean };
    expect(body.finished).toBe(true);
  });

  /* ---------------------------------------------------------------------- *
   * Odeslat teď: přeskočení odpočtu
   *
   * Odpočet NENÍ okno na rozmyšlenou v prohlížeči. Je to odložený start na
   * serveru: materializace zapsala každé zprávě `next_attempt_at = release_at`
   * a claim dotaz senderu má podmínku `next_attempt_at <= now()`. Tlačítko tedy
   * musí sáhnout na server, jinak by se jen přestalo počítat a nic by se
   * nezměnilo.
   * ---------------------------------------------------------------------- */

  async function withUndoWindow(id: string): Promise<void> {
    await migratorClient().query(
      `UPDATE campaigns SET release_at = now() + interval '40 seconds' WHERE id = $1`,
      [id],
    );
    await migratorClient().query(
      `UPDATE messages SET next_attempt_at = now() + interval '40 seconds'
        WHERE campaign_id = $1 AND status = 'pending'`,
      [id],
    );
  }

  async function pendingInFuture(id: string): Promise<number> {
    const r = await migratorClient().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM messages
        WHERE campaign_id = $1 AND status = 'pending' AND next_attempt_at > now()`,
      [id],
    );
    return Number(r.rows[0]?.n ?? '0');
  }

  it('POST /send-now uvolní čekající zprávy odesílacímu procesu', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 3 });
    await withUndoWindow(id);
    expect(await pendingInFuture(id)).toBe(3);

    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/send-now`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await pendingInFuture(id)).toBe(0);
  });

  it('POST /send-now zavře okno na vzetí zpět, protože odeslání je nevratné', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 2 });
    await withUndoWindow(id);

    const before = (await (
      await appFor(ctx.workspace).request(`/campaigns/${id}/progress`)
    ).json()) as { undo_remaining_seconds: number };
    expect(before.undo_remaining_seconds).toBeGreaterThan(0);

    await appFor(ctx.workspace).request(`/campaigns/${id}/send-now`, { method: 'POST' });

    const after = (await (
      await appFor(ctx.workspace).request(`/campaigns/${id}/progress`)
    ).json()) as { undo_remaining_seconds: number };
    expect(after.undo_remaining_seconds).toBe(0);

    const undo = await appFor(ctx.workspace).request(`/campaigns/${id}/undo`, { method: 'POST' });
    expect(undo.status).toBe(409);
    expect((await undo.json()).code).toBe('campaign_undo_window_expired');
  });

  it('POST /send-now po uplynutí okna není chyba, jen nemá co uvolnit', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 1 });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/send-now`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  });

  it('POST /send-now na rozepsané kampani je 409, ne tiché nic', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/send-now`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('invalid_state_transition');
  });

  it('neexistující kampaň je 404, ne 500', async () => {
    const res = await appFor(ctx.workspace).request(
      '/campaigns/00000000-0000-4000-8000-000000000000',
    );
    expect(res.status).toBe(404);
  });

  /* ---------------------------------------------------------------------- *
   * Mazání kampaně
   * ---------------------------------------------------------------------- */

  async function deleteCampaign(id: string): Promise<Response> {
    return appFor(ctx.workspace).request(`/campaigns/${id}`, { method: 'DELETE' });
  }

  it('DELETE rozepsané kampaně vrátí 204 a kampaň zmizí ze seznamu', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });

    expect((await deleteCampaign(id)).status).toBe(204);

    const list = await appFor(ctx.workspace).request('/campaigns');
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(0);
    // Měkké smazání: řádek zůstává, jen ho čtení přeskakují.
    const row = await migratorClient().query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM campaigns WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.deleted_at).not.toBeNull();
  });

  it('DELETE kampaně s propásnutým plánem projde: nikdy nikomu neodešla', async () => {
    const id = await seedCampaign(ctx, { status: 'schedule_missed' });
    expect((await deleteCampaign(id)).status).toBe(204);
  });

  /**
   * Regrese na past, kterou odhalilo mazání odesílací domény: cizí klíč
   * `campaigns.sender_domain_id` je `ON DELETE RESTRICT` a o `deleted_at` neví,
   * takže kampaň v koši držela doménu napořád. Trvalé mazání kampaní API nezná,
   * takže by z toho byla slepá ulička.
   */
  it('DELETE odpojí odesílací účet i doménu, aby je šlo pak odebrat', async () => {
    const providerId = await seedProvider(ctx, { status: 'ready' });
    const domainId = randomUUID();
    await migratorClient().query(
      `INSERT INTO sender_domains (id, workspace_id, provider_id, domain)
       VALUES ($1, $2, $3, 'kolo-shop.cz')`,
      [domainId, ctx.workspaceId, providerId],
    );
    const id = await seedCampaign(ctx, { status: 'draft', providerId });
    await migratorClient().query(`UPDATE campaigns SET sender_domain_id = $1 WHERE id = $2`, [
      domainId,
      id,
    ]);

    expect((await deleteCampaign(id)).status).toBe(204);

    const row = await migratorClient().query<{
      sender_domain_id: string | null;
      provider_id: string | null;
    }>(`SELECT sender_domain_id, provider_id FROM campaigns WHERE id = $1`, [id]);
    expect(row.rows[0]).toEqual({ sender_domain_id: null, provider_id: null });
    // Doména už kampaň nedrží, takže ji jde odebrat bez chyby 23503.
    await expect(
      migratorClient().query(`DELETE FROM sender_domains WHERE id = $1`, [domainId]),
    ).resolves.toBeDefined();
  });

  it('DELETE odeslané kampaně vrátí 409 se stavem, ne 500', async () => {
    const id = await seedCampaign(ctx, { status: 'sent' });

    const res = await deleteCampaign(id);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; params: Record<string, unknown> };
    expect(body.code).toBe('conflict');
    expect(body.params).toMatchObject({ reason: 'campaign_not_draft', status: 'sent' });
    // Kampaň zůstala: drží historii a statistiky.
    const list = await appFor(ctx.workspace).request('/campaigns');
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(1);
  });

  it('DELETE naplánované kampaně vrátí 409: nejdřív se musí zrušit plán', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: -60 });

    const res = await deleteCampaign(id);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { params: Record<string, unknown> };
    expect(body.params).toMatchObject({ status: 'scheduled' });
  });

  it('DELETE odesílané kampaně vrátí 409, rozjetá rozesílka se pod rukama nemaže', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });

    expect((await deleteCampaign(id)).status).toBe(409);
  });

  it('DELETE neexistující kampaně je 404, ne 409', async () => {
    const res = await deleteCampaign('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  /* ---------------------------------------------------------------------- *
   * Pracovní obsah smazané kampaně
   *
   * Kampaň nemá vlastní editor, upravovat se dá jedině šablona. Zakládání
   * kampaně jí proto vyrobí v `templates` VLASTNÍ řádek `kind = 'system'`,
   * který se v knihovně nevypisuje, a namíří na něj `campaigns.template_id`.
   *
   * Ten řádek nese CELÝ TEXT E-MAILU. Dokud smazání kampaně končilo na
   * `campaigns`, zůstával v databázi s `deleted_at IS NULL`, tedy jako obsah,
   * který se z pohledu databáze nikdy nesmazal. Naměřeno na datech: sirotci
   * po každé smazané kampani, od prvního dne.
   * ---------------------------------------------------------------------- */

  /** Pracovní obsah kampaně: řádek `kind = 'system'` napojený přes `template_id`. */
  async function seedWorkingCopy(campaignId: string, name: string): Promise<string> {
    const fields = await getFieldCatalog(ctx.workspace);
    const row = await createTemplate(
      { ctx: ctx.workspace, fields, userId: ctx.userId },
      { name, kind: 'system', document: templateDocument() as Document },
    );
    await migratorClient().query(`UPDATE campaigns SET template_id = $1 WHERE id = $2`, [
      row.id,
      campaignId,
    ]);
    return row.id;
  }

  /** Čte se pod migrátorskou rolí, tedy mimo RLS i mimo filtry domény. */
  async function templateDeletedAt(templateId: string): Promise<string | null> {
    const r = await migratorClient().query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM templates WHERE id = $1`,
      [templateId],
    );
    if (r.rows.length !== 1) throw new Error(`šablona ${templateId} v testovací databázi není`);
    return r.rows[0]!.deleted_at;
  }

  /** Popisek dokumentu šablony. Na něm je poznat, čí obsah se právě čte. */
  async function templateDocumentName(templateId: string): Promise<string> {
    const r = await migratorClient().query<{ design: { meta: { name: string } } }>(
      `SELECT design FROM templates WHERE id = $1`,
      [templateId],
    );
    if (r.rows.length !== 1) throw new Error(`šablona ${templateId} v testovací databázi není`);
    return r.rows[0]!.design.meta.name;
  }

  it('DELETE kampaně měkce smaže i její pracovní obsah, ne jen kampaň', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const workingCopyId = await seedWorkingCopy(id, `Pracovní obsah · ${id}`);

    expect((await deleteCampaign(id)).status).toBe(204);

    expect(await templateDeletedAt(workingCopyId)).not.toBeNull();
  });

  it('DELETE kampaně nechá knihovní šablonu být: není to odpad, je to práce pro příště', async () => {
    const libraryId = await seedTemplateWithLink();
    const id = await seedCampaign(ctx, { status: 'draft' });
    await migratorClient().query(`UPDATE campaigns SET template_id = $1 WHERE id = $2`, [
      libraryId,
      id,
    ]);

    expect((await deleteCampaign(id)).status).toBe(204);

    expect(await templateDeletedAt(libraryId)).toBeNull();
  });

  /**
   * Závora na jiné živé kampaně. Bez ní by smazání jedné z dvojice vzalo obsah
   * i té druhé a editor by u ní hlásil, že šablona neexistuje.
   *
   * SDÍLENÍ SE TU VYRÁBÍ PŘÍMO V DATABÁZI, ne přes `POST /duplicate`, a je to
   * po opravě duplikace JEDINÁ poctivá cesta: `duplicate` teď pracovní obsah
   * KLONUJE, takže by tudy sdílený stav vůbec nevznikl a test by prošel
   * naprázdno, aniž by závoru vyzkoušel.
   *
   * Takhle spárované kampaně v databázích existují: vyrobila je duplikace
   * z doby před opravou a měkké smazání je nepřepisuje. Závora je proto pro
   * dnešek zbytečná a pro data ze včerejška nutná.
   */
  it('DELETE kampaně nesahá na pracovní obsah, který drží ještě jiná živá kampaň', async () => {
    const first = await seedCampaign(ctx, { status: 'draft' });
    const second = await seedCampaign(ctx, { status: 'draft' });
    const workingCopyId = await seedWorkingCopy(first, `Sdílený obsah · ${first}`);
    // Druhá kampaň se na týž řádek namíří ručně, tedy do stavu, jaký po sobě
    // nechala duplikace před opravou.
    await migratorClient().query(`UPDATE campaigns SET template_id = $1 WHERE id = $2`, [
      workingCopyId,
      second,
    ]);

    expect((await deleteCampaign(second)).status).toBe(204);
    expect(await templateDeletedAt(workingCopyId)).toBeNull();

    // A jakmile odejde i ta druhá, obsah odejde s ní. Závora nic nedrží navěky.
    expect((await deleteCampaign(first)).status).toBe(204);
    expect(await templateDeletedAt(workingCopyId)).not.toBeNull();
  });

  /**
   * Tichá ztráta dat, ne kosmetika. Dokud `duplicate` přebíral `template_id`
   * beze změny, byla kopie a předloha JEDEN řádek `templates`, a protože obsah
   * kampaně se edituje výhradně přes něj, přepsala úprava kopie obsah předlohy.
   * Bez chyby a bez cesty zpátky.
   */
  it('duplikace dá kopii vlastní pracovní obsah, úprava kopie nepřepíše předlohu', async () => {
    const original = await seedCampaign(ctx, { status: 'draft' });
    const originalName = `Obsah předlohy · ${original}`;
    const originalCopyId = await seedWorkingCopy(original, originalName);

    const duplicated = await appFor(ctx.workspace).request(`/campaigns/${original}/duplicate`, {
      method: 'POST',
    });
    expect(duplicated.status).toBe(201);
    const copy = (await duplicated.json()) as { id: string; template_id: string | null };

    // Odpověď musí nést NOVÝ řádek. Kdyby v ní zůstal ten původní, poslala by
    // obrazovka uživatele upravovat pracovní obsah předlohy.
    expect(copy.template_id).not.toBeNull();
    expect(copy.template_id).not.toBe(originalCopyId);

    const source = templateDocument() as Document;
    const changed: Document = { ...source, meta: { ...source.meta, name: 'Přepsáno v kopii' } };
    const fields = await getFieldCatalog(ctx.workspace);
    await saveDesign(
      { ctx: ctx.workspace, fields, userId: ctx.userId },
      copy.template_id!,
      changed,
    );

    expect(await templateDocumentName(copy.template_id!)).toBe('Přepsáno v kopii');
    expect(await templateDocumentName(originalCopyId)).toBe(originalName);
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

/**
 * Náhled odeslané podoby kampaně.
 *
 * Cena celé té cesty je v tom, že NIC nekompiluje. Kdyby si tělo vyráběla znovu,
 * ukázala by uživateli, co by z dnešní šablony vzniklo dnes, a to je přesně to,
 * co se má náhledem vyvrátit. Testuje se to tak, že se uložené tělo v databázi
 * změní na hodnotu, kterou by žádná kompilace nevydala, a odpověď ji musí nést.
 */
describe('GET /campaigns/{id}/preview vrací uloženou podobu', () => {
  let ctx: TestWorkspace;

  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('vrací uložené sloupce, ne čerstvou kompilaci', async () => {
    const id = await seedCampaign(ctx, { status: 'sent', subject: 'Sleva 30 %', compiled: true });
    await migratorClient().query(
      `UPDATE campaigns
          SET compiled_html = '<p>tohle doopravdy odešlo</p>',
              compiled_text = 'tohle doopravdy odešlo',
              compiled_at = now()
        WHERE id = $1`,
      [id],
    );

    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      html: string | null;
      text: string | null;
      compiled_at: string | null;
      revision: number;
      status: string;
      subject: string;
    };
    expect(body.html).toBe('<p>tohle doopravdy odešlo</p>');
    expect(body.text).toBe('tohle doopravdy odešlo');
    expect(body.status).toBe('sent');
    expect(body.subject).toBe('Sleva 30 %');
    expect(typeof body.revision).toBe('number');
    // Kontrakt slibuje řetězec, ne objekt data: ovladač vrací `timestamptz`
    // jako `Date` a cesta ho musí převést.
    expect(typeof body.compiled_at).toBe('string');
  });

  it('nezkompilovaná kampaň je 200 s html null, ne 404', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { html: string | null; compiled_at: string | null };
    // 404 by lhalo: kampaň existuje, jen se ještě nekompilovala.
    expect(body.html).toBeNull();
    expect(body.compiled_at).toBeNull();
  });

  it('kampaň cizího projektu je 404', async () => {
    const other = await withTestWorkspace();
    const id = await seedCampaign(other, { status: 'sent', compiled: true });
    const res = await appFor(ctx.workspace).request(`/campaigns/${id}/preview`);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });
});
