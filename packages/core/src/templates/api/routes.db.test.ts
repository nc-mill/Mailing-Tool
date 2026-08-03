import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import { ApiError } from '../../errors/api-error';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import type { WorkspaceContext } from '../../identity/types';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import * as schema from '@mlain/db/schema';
import { registerTemplateRoutes } from './templates.routes';
import { validationHook, type TemplatesEnv } from './index';

/**
 * Cesty veřejného API domény šablon proti skutečné databázi.
 *
 * Testovací obal dělá v malém totéž, co v provozu kostra aplikace z P04
 * (`apps/web/src/lib/api/app.ts`), kterou `packages/core` importovat nesmí:
 * doplní proměnnou `auth` a přeloží `ApiError` na stavový kód z registru.
 * Bez něj by `not_found` z domény skončil jako 500 a test by měřil chybějící
 * middleware, ne chování cesty.
 */
function appFor(ctx: WorkspaceContext): OpenAPIHono<TemplatesEnv> {
  const app = new OpenAPIHono<TemplatesEnv>({ defaultHook: validationHook });
  app.use('*', async (c, next) => {
    c.set('auth', { ctx, label: 'test' });
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        {
          code: error.code,
          errors: error.errors ?? null,
          findings: error.findings ?? null,
          request_id: 'test',
        },
        error.status as 400,
      );
    }
    throw error;
  });
  registerTemplateRoutes(app);
  return app;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };

/** Nejmenší platný dokument: sekce s patičkou, tedy i s odkazem na odhlášení. */
function design(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    meta: { name: 'T', previewText: 'Náhledový text', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [footer],
      },
    ],
    ...overrides,
  };
}

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

async function freshApp() {
  const ws = await seedWorkspaceForCoreTests();
  return { ws, app: appFor(ws.ctx) };
}

async function createTemplateVia(
  app: OpenAPIHono<TemplatesEnv>,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.request('/templates', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('REST API šablon', () => {
  it('šablonu založí, uloží do ní návrh a načte ji zpět', async () => {
    const { app } = await freshApp();

    const created = await createTemplateVia(app, {
      name: 'První',
      kind: 'campaign',
      document: design(),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ name: 'První', validation_state: 'valid' });
    expect(created.body).toHaveProperty('schema_version', 1);
    expect(created.body.design_hash).toMatch(/^[0-9a-f]{64}$/);

    // Uložení návrhu s optimistickým zámkem. Text v patičce se změní, takže se
    // musí změnit i hash; kdyby se návrh neuložil, zůstal by stejný.
    const changed = design({
      meta: { name: 'T', previewText: 'Jiný náhledový text', language: 'cs' },
    });
    const saved = await app.request(`/templates/${String(created.body.id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ design: changed, if_design_hash: created.body.design_hash }),
    });
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as Record<string, unknown>;
    expect(savedBody.design_hash).not.toBe(created.body.design_hash);

    // A teď to podstatné: načtení zpět SAMOSTATNÝM požadavkem, ne z odpovědi
    // na zápis. Jen tak se pozná, že se návrh opravdu uložil do databáze.
    const read = await app.request(`/templates/${String(created.body.id)}`);
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as Record<string, unknown>;
    expect(readBody.design_hash).toBe(savedBody.design_hash);
    expect((readBody.design as { meta: { previewText: string } }).meta.previewText).toBe(
      'Jiný náhledový text',
    );
  });

  it('neplatný dokument odmítne 422 a nálezem s cestou, a nic neuloží', async () => {
    const { ws, app } = await freshApp();
    const created = await createTemplateVia(app, {
      name: 'Rozbitá',
      document: design({ blocks: [{ id: 'bad' }] }),
    });
    expect(created.status).toBe(422);
    expect(created.body.code).toBe('template_document_invalid');
    const findings = created.body.findings as Array<Record<string, unknown>>;
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toHaveProperty('path');

    // Odmítnutý dokument nesmí po sobě nechat řádek. Plán P08 zakládal šablonu
    // dřív, než se na stav validace podíval, takže neplatná šablona zůstala
    // v seznamu.
    const rows = await withWorkspace(ws.ctx, (tx) => tx.select().from(schema.templates));
    expect(rows).toHaveLength(0);
  });

  it('dokument s příliš mnoha bloky odmítne 413', async () => {
    const { app } = await freshApp();
    const many = design({
      blocks: Array.from({ length: 40 }, (_, i) => ({
        id: `b_a${String(i).padStart(11, '0')}`,
        type: 'section',
        props: blockDefaults('section'),
        children: Array.from({ length: 8 }, (_, j) => ({
          id: `b_b${String(i).padStart(5, '0')}${String(j).padStart(6, '0')}`,
          type: 'spacer',
          props: blockDefaults('spacer'),
        })),
      })),
    });
    const created = await createTemplateVia(app, { name: 'Moc bloků', document: many });
    expect(created.status).toBe(413);
    expect(created.body.code).toBe('content_too_many_blocks');
  });

  it('při neshodě hashe vrací 412, ne tichý přepis', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'A', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ design: design(), if_design_hash: '00'.repeat(32) }),
    });
    expect(response.status).toBe(412);
    expect(((await response.json()) as { code: string }).code).toBe('precondition_failed');
  });

  it('rozbitý if_design_hash je 422, ne 412', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'A', document: design() });
    for (const bad of ['', 'abc', 'zz'.repeat(32), 'a'.repeat(63)]) {
      const response = await app.request(`/templates/${String(created.body.id)}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ design: design(), if_design_hash: bad }),
      });
      // 412 by znamenalo „změnil to někdo jiný", což je nepravda: klient poslal
      // nesmysl a musí se to dozvědět.
      expect(response.status, bad).toBe(422);
    }
  });

  it('cizí šablona je 404, nikdy 403', async () => {
    const owner = await freshApp();
    const stranger = await freshApp();
    const created = await createTemplateVia(owner.app, { name: 'A', document: design() });
    const response = await stranger.app.request(`/templates/${String(created.body.id)}`);
    expect(response.status).toBe(404);
  });

  it('kolize jména je 409 s kódem template_name_conflict, ne 500', async () => {
    const { app } = await freshApp();
    const first = await createTemplateVia(app, { name: 'Stejné jméno', document: design() });
    expect(first.status).toBe(201);
    const second = await createTemplateVia(app, { name: 'Stejné jméno', document: design() });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('template_name_conflict');
  });

  it('duplikát dostane vlastní jméno a je to samostatná šablona', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Zdroj', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}/duplicate`, {
      method: 'POST',
    });
    expect(response.status).toBe(201);
    const copy = (await response.json()) as Record<string, unknown>;
    expect(copy.name).toBe('Zdroj (kopie)');
    expect(copy.id).not.toBe(created.body.id);
  });

  it('kompilace nic neukládá a vrací metadata kontraktu 5', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'A', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}/compile`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      html: string;
      meta: { contract_version: number; has_unsubscribe_link: boolean };
    };
    expect(body.html).toContain('<!DOCTYPE html>');
    expect(body.meta.contract_version).toBe(1);
    expect(body.meta.has_unsubscribe_link).toBe(true);
  });

  it('náhled dosadí vzorová data a varianta bez jména je vyprázdní', async () => {
    const { app } = await freshApp();
    const withGreeting = design({
      blocks: [
        {
          id: 'b_000000000001',
          type: 'section',
          props: blockDefaults('section'),
          children: [
            {
              id: 'b_000000000002',
              type: 'text',
              props: {
                ...blockDefaults('text'),
                content: [
                  {
                    t: 'p',
                    children: [
                      { t: 's', v: 'Dobrý den, ' },
                      { t: 'var', expr: 'contact.first_name | default', fallback: 'zákazníku' },
                    ],
                  },
                ],
              },
            },
            footer,
          ],
        },
      ],
    });
    const created = await createTemplateVia(app, { name: 'Náhled', document: withGreeting });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const preview = async (previewData: unknown) => {
      const response = await app.request(`/templates/${String(created.body.id)}/preview`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ preview_data: previewData }),
      });
      const parsed = (await response.json()) as { html: string; text: string };
      expect(response.status, JSON.stringify(parsed)).toBe(200);
      return parsed;
    };

    const normal = await preview({ type: 'sample', variant: 'default' });
    expect(normal.html).toContain('Přemyslav-Řehoř');
    // Kritérium 55: varianta bez jména musí spadnout na hodnotu z filtru
    // `default`, jinak by uživatel nikdy neviděl, jak e-mail vypadá pro
    // kontakt bez vyplněných osobních údajů.
    const noName = await preview({ type: 'sample', variant: 'no_name' });
    expect(noName.html).not.toContain('Přemyslav-Řehoř');
    expect(noName.html).toContain('zákazníku');
  });

  it('náhled pro konkrétní kontakt bere jeho skutečná data', async () => {
    const { ws, app } = await freshApp();
    await withWorkspace(ws.ctx, (tx) =>
      tx.insert(schema.contacts).values({
        id: '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e',
        workspaceId: ws.workspaceId,
        email: 'jana@example.cz',
        firstName: 'Jana',
        greeting: 'Dobrý den, Jano',
      }),
    );
    const withName = design({
      blocks: [
        {
          id: 'b_000000000001',
          type: 'section',
          props: blockDefaults('section'),
          children: [
            {
              id: 'b_000000000002',
              type: 'text',
              props: {
                ...blockDefaults('text'),
                content: [
                  {
                    t: 'p',
                    children: [
                      { t: 'var', expr: 'contact.first_name | default', fallback: 'zákazníku' },
                    ],
                  },
                ],
              },
            },
            footer,
          ],
        },
      ],
    });
    const created = await createTemplateVia(app, { name: 'Kontakt', document: withName });
    const response = await app.request(`/templates/${String(created.body.id)}/preview`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        preview_data: { type: 'contact', contact_id: '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e' },
      }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { html: string }).html).toContain('Jana');
  });

  it('kontrola vrací nálezy a stav podle toho, jestli některý blokuje', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'A', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}/validate`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });
    expect([200, 409]).toContain(response.status);
    const body = (await response.json()) as { findings: Array<{ code: string }> };
    expect(body).toHaveProperty('findings');
    // Odkaz na odhlášení v dokumentu je, takže tenhle nález padnout nesmí.
    expect(body.findings.map((f) => f.code)).not.toContain('precheck_missing_unsubscribe');
  });

  it('verze se založí, vypíše a obnoví, a ukazatel na aktuální verzi drží', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'A', document: design() });
    const id = String(created.body.id);

    const first = await app.request(`/templates/${id}/versions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ label: 'první' }),
    });
    expect(first.status).toBe(201);
    expect((await first.json()) as { version: number }).toMatchObject({ version: 1 });

    // Ukazatel na aktuální verzi plní `createVersion`; natvrdo null by zahodilo
    // hodnotu, kterou databáze má.
    const detail = (await (await app.request(`/templates/${id}`)).json()) as Record<
      string,
      unknown
    >;
    expect(detail.current_version_id).toBeTypeOf('string');

    // Druhý návrh, druhá verze, pak návrat na první.
    await app.request(`/templates/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        design: design({ meta: { name: 'T', previewText: 'Druhý', language: 'cs' } }),
      }),
    });
    const second = await app.request(`/templates/${id}/versions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ label: 'druhá' }),
    });
    expect((await second.json()) as { version: number }).toMatchObject({ version: 2 });

    const restored = await app.request(`/templates/${id}/versions/1/restore`, { method: 'POST' });
    expect(restored.status).toBe(201);

    const after = (await (await app.request(`/templates/${id}`)).json()) as {
      design: { meta: { previewText: string } };
    };
    expect(after.design.meta.previewText).toBe('Náhledový text');

    // Obnovení je dopředné: historie se nepřepisuje, přibude třetí verze.
    const list = (await (await app.request(`/templates/${id}/versions`)).json()) as {
      items: Array<{ version: number; reason: string }>;
    };
    expect(list.items.map((item) => item.version).sort()).toEqual([1, 2, 3]);
    expect(list.items.find((item) => item.version === 3)?.reason).toBe('restore');
  });

  it('dopadová analýza pole najde šablonu, která ho používá', async () => {
    const { app } = await freshApp();
    const usingField = design({
      blocks: [
        {
          id: 'b_000000000001',
          type: 'section',
          props: blockDefaults('section'),
          children: [
            {
              id: 'b_000000000002',
              type: 'text',
              props: {
                ...blockDefaults('text'),
                content: [
                  {
                    t: 'p',
                    children: [
                      { t: 'var', expr: 'contact.first_name | default', fallback: 'zákazníku' },
                    ],
                  },
                ],
              },
            },
            footer,
          ],
        },
      ],
    });
    const created = await createTemplateVia(app, { name: 'S polem', document: usingField });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    // Statická cesta se musí trefit dřív než `/templates/{id}`. Kdyby ji vzor
    // parametru pohltil, vrátilo by se 422 o neplatném UUID.
    const response = await app.request('/templates/field-usage?field=contact.first_name');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ id: string; name: string }> };
    expect(body.items.map((item) => item.name)).toContain('S polem');
  });

  it('testovací odeslání vrací 202 a zařadí zprávy do outboxu', async () => {
    const { ws, app } = await freshApp();
    // Odesílání musí být nastavené: identita se bere z uživatelské kampaně.
    await withWorkspace(ws.ctx, async (tx) => {
      await tx
        .insert(schema.contacts)
        .values({ workspaceId: ws.workspaceId, email: 'kontakt@example.cz' });
      const [provider] = await tx
        .insert(schema.sendingProviders)
        .values({
          workspaceId: ws.workspaceId,
          name: 'SMTP',
          type: 'smtp',
          configEncrypted: 'enc:v1:test',
          status: 'ready',
        })
        .returning({ id: schema.sendingProviders.id });
      await tx.insert(schema.campaigns).values({
        workspaceId: ws.workspaceId,
        name: 'Jarní novinky',
        subject: 'Jaro',
        fromName: 'Demo',
        fromEmail: 'demo@example.cz',
        providerId: provider!.id,
      });
    });

    const created = await createTemplateVia(app, { name: 'K testu', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}/test-send`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ recipients: ['kolega@example.cz'] }),
    });
    // 202, ne 200: požadavek zprávu jen zařadil, odesílá ji sender.
    expect(response.status, await response.clone().text()).toBe(202);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({ created: 1 });

    const queued = await withWorkspace(ws.ctx, (tx) =>
      tx.select({ email: schema.messages.email, kind: schema.messages.kind }).from(schema.messages),
    );
    expect(queued).toEqual([{ email: 'kolega@example.cz', kind: 'test' }]);
  });

  it('testovací odeslání bez nastaveného odesílání je 422, ne 500', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Bez odesílání', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}/test-send`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ recipients: ['kolega@example.cz'] }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; errors: Array<{ code: string }> };
    expect(body.code).toBe('validation_failed');
    expect(body.errors.map((e) => e.code)).toContain('test_sending_not_configured');
  });

  it('testovací odeslání odmítne šest adres už na schématu cesty', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Moc adres', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}/test-send`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        recipients: ['a@x.cz', 'b@x.cz', 'c@x.cz', 'd@x.cz', 'e@x.cz', 'f@x.cz'],
      }),
    });
    expect(response.status).toBe(422);
  });

  it('smazaná šablona zmizí ze seznamu a z detailu', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Ke smazání', document: design() });
    const id = String(created.body.id);
    expect((await app.request(`/templates/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/templates/${id}`)).status).toBe(404);
    const list = (await (await app.request('/templates')).json()) as { items: unknown[] };
    expect(list.items).toHaveLength(0);
  });
});
