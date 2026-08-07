import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import { ApiError } from '../../errors/api-error';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import type { WorkspaceContext } from '../../identity/types';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import { eq } from 'drizzle-orm';
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

/**
 * Textový blok. Bez něj je dokument sice platný, ale PRÁZDNÝ, a testovací
 * odeslání ho od opravy vady s prázdným e-mailem odmítá dřív, než se dostane
 * k tomu, co jednotlivé testy zkoumají.
 */
const text = {
  id: 'b_000000000010',
  type: 'text',
  props: { ...blockDefaults('text'), content: [{ t: 'p', children: [{ t: 's', v: 'Ahoj.' }] }] },
};

/** Nejmenší dokument s obsahem: sekce s textem a patičkou (tedy i s odkazem na odhlášení). */
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
        children: [text, footer],
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

  /**
   * NÁHLED MUSÍ ZNÍT JAKO ODESLANÝ E-MAIL, i ve vzorové větě.
   *
   * Vzorová data se do 7. 8. 2026 skládala s výchozím vykáním, protože jim
   * volající předával jen jazyk. Projekt přepnutý na tykání tedy v náhledu
   * viděl „Dobrý den, Přemyslave-Řehoři" u e-mailu, který odejde s „Ahoj".
   * U skutečného kontaktu vada nebyla, bere se jeho uložený sloupec.
   */
  it('vzorové oslovení v náhledu zná nastavení projektu', async () => {
    const { ws, app } = await freshApp();
    await withWorkspace(ws.ctx, (tx) =>
      tx
        .update(schema.workspaces)
        .set({ addressForm: 'informal' })
        .where(eq(schema.workspaces.id, ws.workspaceId)),
    );

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
                content: [{ t: 'p', children: [{ t: 'var', expr: 'contact.greeting' }] }],
              },
            },
            footer,
          ],
        },
      ],
    });
    const created = await createTemplateVia(app, { name: 'Tykani', document: withGreeting });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const response = await app.request(`/templates/${String(created.body.id)}/preview`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ preview_data: { type: 'sample', variant: 'default' } }),
    });
    const parsed = (await response.json()) as { html: string };
    expect(response.status, JSON.stringify(parsed)).toBe(200);
    expect(parsed.html).toContain('Ahoj Přemyslave-Řehoři');
    expect(parsed.html).not.toContain('Dobrý den');
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

  it('obnova vrátí smazanou šablonu do seznamu i do detailu', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Vrácená', document: design() });
    const id = String(created.body.id);
    await app.request(`/templates/${id}`, { method: 'DELETE' });

    const restored = await app.request(`/templates/${id}/restore`, { method: 'POST' });

    expect(restored.status).toBe(200);
    expect((await app.request(`/templates/${id}`)).status).toBe(200);
    const list = (await (await app.request('/templates')).json()) as { items: unknown[] };
    expect(list.items).toHaveLength(1);
  });

  it('obnova skončí konfliktem, když jméno mezitím zabrala jiná šablona', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Sporná', document: design() });
    const id = String(created.body.id);
    await app.request(`/templates/${id}`, { method: 'DELETE' });
    await createTemplateVia(app, { name: 'Sporná', document: design() });

    const response = await app.request(`/templates/${id}/restore`, { method: 'POST' });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('template_name_conflict');
  });

  it('obnova neznámé šablony je 404', async () => {
    const { app } = await freshApp();
    // Platné UUID verze 7, jaké schéma cesty požaduje. Samé nuly by neprošly
    // validací a test by měřil schéma, ne chování obnovy.
    const response = await app.request('/templates/01890000-0000-7000-8000-000000000000/restore', {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });
});

describe('přejmenování šablony', () => {
  it('PATCH se samotným `name` přejmenuje řádek i dokument', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, {
      name: 'E-mail z formuláře test',
      kind: 'transactional',
      document: design(),
    });
    const id = String(created.body.id);

    const response = await app.request(`/templates/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Děkujeme za zprávu' }),
    });

    // Dřív tahle cesta vracela 422 „Chybí `design`" a přejmenovat nešlo vůbec.
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      name: string;
      design: { meta: { name: string } };
      design_hash: string;
    };
    expect(body.name).toBe('Děkujeme za zprávu');
    expect(body.design.meta.name).toBe('Děkujeme za zprávu');
    // Klient musí dostat nový hash, jinak mu příští uložení spadne na 412.
    expect(body.design_hash).not.toBe(String(created.body.design_hash));
  });

  it('prázdné tělo je chyba volajícího, ne tichý zápis', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Něco', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(422);
  });

  it('jméno ze samých mezer ohlásí u pole `name`, ne jako obecnou hlášku', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Něco', document: design() });

    const response = await app.request(`/templates/${String(created.body.id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: '   ' }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { errors: Array<{ path: string }> | null };
    expect(body.errors?.[0]?.path).toBe('name');
  });

  it('delší jméno než 120 znaků neprojde schématem', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Něco', document: design() });
    const response = await app.request(`/templates/${String(created.body.id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'x'.repeat(121) }),
    });
    expect(response.status).toBe(422);
  });

  it('obsazené jméno je 409, ne pětistovka', async () => {
    const { app } = await freshApp();
    await createTemplateVia(app, { name: 'Zabrané', document: design() });
    const created = await createTemplateVia(app, { name: 'Moje', document: design() });

    const response = await app.request(`/templates/${String(created.body.id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Zabrané' }),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('template_name_conflict');
  });

  it('návrh a jméno naráz projdou jedním požadavkem', async () => {
    const { app } = await freshApp();
    const created = await createTemplateVia(app, { name: 'Původní', document: design() });
    const id = String(created.body.id);

    const response = await app.request(`/templates/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        design: design({ meta: { name: 'Původní', previewText: 'Jiný', language: 'cs' } }),
        name: 'Nové jméno',
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      name: string;
      design: { meta: { name: string; previewText: string } };
    };
    // Pořadí je závazné: uložení návrhu, teprve pak přejmenování. Obráceně by
    // uložený návrh přepsal `meta.name` zpátky na staré jméno.
    expect(body.name).toBe('Nové jméno');
    expect(body.design.meta.name).toBe('Nové jméno');
    expect(body.design.meta.previewText).toBe('Jiný');
  });
});

describe('kategorie v API šablon', () => {
  type ListBody = {
    items: Array<{
      id: string;
      name: string;
      category: string;
      usage: { forms: Array<{ name: string }>; lists: Array<{ name: string; role: string }> };
    }>;
    counts: { all: number; campaign: number; form: number; transactional: number; page: number };
  };

  /**
   * `uq_forms__slug` je unikátní GLOBÁLNĚ, ne v rámci projektu: veřejný
   * endpoint `/f/{slug}` hledá formulář bez znalosti projektu. Pevný řetězec
   * by proto ve druhém testu spadl na 23505.
   */
  let formSeq = 0;
  const formSlug = () => {
    formSeq += 1;
    return `form${formSeq}${Math.random().toString(36).slice(2)}`.slice(0, 24).padEnd(16, '0');
  };

  async function seeded() {
    const { ws, app } = await freshApp();
    const campaign = await createTemplateVia(app, {
      name: 'Newsletter',
      kind: 'campaign',
      document: design(),
    });
    const formEmail = await createTemplateVia(app, {
      name: 'Z formuláře',
      kind: 'transactional',
      document: design(),
    });
    const standalone = await createTemplateVia(app, {
      name: 'Potvrzení',
      kind: 'transactional',
      document: design(),
    });
    await withWorkspace(ws.ctx, (tx) =>
      tx.insert(schema.forms).values({
        workspaceId: ws.ctx.workspaceId,
        name: 'Patička webu',
        slug: formSlug(),
        deliveryTemplateId: String(formEmail.body.id),
      }),
    );
    return {
      app,
      ids: {
        campaign: String(campaign.body.id),
        formEmail: String(formEmail.body.id),
        standalone: String(standalone.body.id),
      },
    };
  }

  const list = async (app: OpenAPIHono<TemplatesEnv>, query: string): Promise<ListBody> =>
    (await (await app.request(`/templates?view=summary${query}`)).json()) as ListBody;

  it('úsporná položka nese kategorii i zapojení', async () => {
    const { app, ids } = await seeded();
    const body = await list(app, '');

    const byId = new Map(body.items.map((item) => [item.id, item]));
    expect(byId.get(ids.campaign)?.category).toBe('campaign');
    expect(byId.get(ids.formEmail)?.category).toBe('form');
    expect(byId.get(ids.formEmail)?.usage.forms.map((form) => form.name)).toEqual(['Patička webu']);
    expect(byId.get(ids.standalone)?.category).toBe('transactional');
    expect(byId.get(ids.standalone)?.usage).toEqual({ forms: [], lists: [] });
  });

  it('filtr vrátí jen zvolenou kategorii, počty přitom platí o celé knihovně', async () => {
    const { app, ids } = await seeded();

    const forms = await list(app, '&category=form');
    expect(forms.items.map((item) => item.id)).toEqual([ids.formEmail]);
    // Počty se filtrem NEMĚNÍ, jinak by přepínače po prvním kliknutí ukazovaly
    // všude nulu a nedalo by se poznat, kam se vyplatí přepnout.
    expect(forms.counts).toEqual({ all: 3, campaign: 1, form: 1, transactional: 1, page: 0 });

    const campaigns = await list(app, '&category=campaign');
    expect(campaigns.items.map((item) => item.id)).toEqual([ids.campaign]);
  });

  it('neznámá kategorie je chyba volajícího, ne tichá knihovna beze změny', async () => {
    const { app } = await seeded();
    const response = await app.request('/templates?category=cokoli');
    expect(response.status).toBe(422);
  });

  it('šablonu rozesílanou formulářem odmítne smazat s kódem template_in_use', async () => {
    const { app, ids } = await seeded();

    const response = await app.request(`/templates/${ids.formEmail}`, { method: 'DELETE' });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('template_in_use');
    // Volnou šablonu to nijak neomezuje.
    expect((await app.request(`/templates/${ids.standalone}`, { method: 'DELETE' })).status).toBe(
      204,
    );
  });
});
