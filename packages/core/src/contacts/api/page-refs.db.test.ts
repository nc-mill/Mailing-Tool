import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import { ApiError } from '../../errors/api-error';
import { seedWorkspaceForCoreTests, type SeededWorkspace } from '../../identity/test-helpers';
import { createTemplateRow } from '../../templates/repository';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import type { WorkspaceContext } from '../../identity/types';
import { registerFormRoutes } from './forms.routes';
import { registerListRoutes } from './lists.routes';
import { validationHook, type ContactsEnv } from './index';

/**
 * ODKAZY NA VEŘEJNÉ STRÁNKY V API FORMULÁŘŮ A SEZNAMŮ.
 *
 * Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md,
 * oddíly 0.3, 4.4 a 5.
 *
 * Testuje se přes skutečné cesty, ne přes repozitář: závora na druh šablony
 * bydlí v API (`page-refs.ts`) a repozitář o ní neví, takže test nad repozitářem
 * by prošel i tehdy, kdyby se kontrola nikdy nezavolala.
 *
 * Obal kolem `OpenAPIHono` dělá v malém totéž, co v provozu kostra aplikace
 * z P04 (`apps/web/src/lib/api/app.ts`), kterou `packages/core` importovat
 * nesmí: doplní proměnnou `auth` a přeloží `ApiError` na stavový kód.
 */
function appFor(ctx: WorkspaceContext): OpenAPIHono<ContactsEnv> {
  const app = new OpenAPIHono<ContactsEnv>({ defaultHook: validationHook });
  app.use('*', async (c, next) => {
    c.set('auth', { ctx, label: 'test' });
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { code: error.code, errors: error.errors ?? null, request_id: 'test' },
        error.status as 400,
      );
    }
    throw error;
  });
  registerListRoutes(app);
  registerFormRoutes(app);
  return app;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Nejmenší platný dokument. Obsah tady nikoho nezajímá, rozhoduje `kind`. */
function design(name: string): Document {
  return {
    schemaVersion: 1,
    meta: { name, previewText: '', language: 'cs' },
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
            props: {
              ...blockDefaults('text'),
              content: [{ t: 'p', children: [{ t: 's', v: 'Ahoj.' }] }],
            },
          },
        ],
      },
    ],
  } as unknown as Document;
}

async function seedTemplate(
  ws: SeededWorkspace,
  kind: 'page' | 'campaign',
  name: string,
): Promise<string> {
  const row = await withWorkspace(ws.ctx, async (tx) =>
    createTemplateRow(tx, ws.ctx, { name, kind, design: design(name), usedFields: [] }),
  );
  return row.id;
}

type Reply = { status: number; body: Record<string, unknown> };

async function call(
  app: OpenAPIHono<ContactsEnv>,
  method: 'POST' | 'PATCH' | 'GET',
  path: string,
  body?: Record<string, unknown>,
): Promise<Reply> {
  const response = await app.request(path, {
    method,
    headers: JSON_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** První chyba validace jako dvojice cesta a kód. Zbytek obálky test nezajímá. */
function firstIssue(reply: Reply): { path: string; code: string } | null {
  const first = (reply.body['errors'] as { path: string; code: string }[] | null | undefined)?.[0];
  return first === undefined ? null : { path: first.path, code: first.code };
}

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('Formulář a odkaz na veřejnou stránku', () => {
  it('přijme návrh druhu page a vydá ho zpátky ve všech třech polích', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const app = appFor(ws.ctx);
    const page = await seedTemplate(ws, 'page', 'Děkujeme');

    const created = await call(app, 'POST', '/forms', { name: 'Newsletter' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body['data'] as { id: string }).id;

    const patched = await call(app, 'PATCH', `/forms/${id}`, {
      thanks_template_id: page,
      confirmed_template_id: page,
      already_subscribed_template_id: page,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body['data']).toMatchObject({
      thanks_template_id: page,
      confirmed_template_id: page,
      already_subscribed_template_id: page,
    });

    // Čtení musí vracet totéž, co zápis. Odkazy bydlí v jsonb `design.pages`,
    // takže se dají snadno ztratit při přepisu celé definice formuláře.
    const read = await call(app, 'GET', `/forms/${id}`);
    expect(read.body['data']).toMatchObject({ thanks_template_id: page });
  });

  it('vrácení na výchozí text uloží null, ne prázdný řetězec', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const app = appFor(ws.ctx);
    const page = await seedTemplate(ws, 'page', 'Děkujeme');

    const created = await call(app, 'POST', '/forms', {
      name: 'Newsletter',
      thanks_template_id: page,
    });
    const id = (created.body['data'] as { id: string }).id;

    const patched = await call(app, 'PATCH', `/forms/${id}`, { thanks_template_id: null });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((patched.body['data'] as Record<string, unknown>)['thanks_template_id']).toBeNull();
  });

  it('odmítne e-mail místo stránky, místo aby ho tiše uložil', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const app = appFor(ws.ctx);
    const email = await seedTemplate(ws, 'campaign', 'Kampaň');

    const created = await call(app, 'POST', '/forms', { name: 'Newsletter' });
    const id = (created.body['data'] as { id: string }).id;

    const patched = await call(app, 'PATCH', `/forms/${id}`, { thanks_template_id: email });
    expect(patched.status, JSON.stringify(patched.body)).toBe(422);
    expect(patched.body['code']).toBe('validation_failed');
    expect(firstIssue(patched)).toEqual({
      path: 'thanks_template_id',
      code: 'not_a_page_template',
    });

    // A hlavně: nic se neuložilo. Tichý zápis by znamenal, že se na naši doménu
    // vykreslí obsah kampaně i s blokem syrového HTML.
    const read = await call(app, 'GET', `/forms/${id}`);
    expect((read.body['data'] as Record<string, unknown>)['thanks_template_id']).toBeNull();
  });

  it('odmítne stránku z cizího projektu', async () => {
    const mine = await seedWorkspaceForCoreTests();
    const other = await seedWorkspaceForCoreTests();
    const app = appFor(mine.ctx);
    const foreign = await seedTemplate(other, 'page', 'Cizí stránka');

    const created = await call(app, 'POST', '/forms', { name: 'Newsletter' });
    const id = (created.body['data'] as { id: string }).id;

    const patched = await call(app, 'PATCH', `/forms/${id}`, { confirmed_template_id: foreign });
    expect(patched.status, JSON.stringify(patched.body)).toBe(422);
    expect(firstIssue(patched)).toEqual({
      path: 'confirmed_template_id',
      code: 'unknown_reference',
    });
  });

  it('odmítne cizí stránku už při založení formuláře', async () => {
    const mine = await seedWorkspaceForCoreTests();
    const other = await seedWorkspaceForCoreTests();
    const app = appFor(mine.ctx);
    const foreign = await seedTemplate(other, 'page', 'Cizí stránka');

    const created = await call(app, 'POST', '/forms', {
      name: 'Newsletter',
      thanks_template_id: foreign,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(422);
    expect(firstIssue(created)).toEqual({ path: 'thanks_template_id', code: 'unknown_reference' });
  });
});

/**
 * Sdílení stránek mezi formuláři, tedy požadavek zadavatele z oddílu 0.3 plánu:
 * šablona je sdílená, ale odkaz na ni je u KAŽDÉHO formuláře zvlášť.
 */
describe('Dva formuláře a jedna knihovna stránek', () => {
  it('smějí ukazovat na tutéž stránku a přehození u jednoho druhý nezmění', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const app = appFor(ws.ctx);
    const spolecna = await seedTemplate(ws, 'page', 'Společná');
    const jina = await seedTemplate(ws, 'page', 'Jiná');

    const a = (
      (await call(app, 'POST', '/forms', { name: 'A', thanks_template_id: spolecna })).body[
        'data'
      ] as { id: string }
    ).id;
    const b = (
      (await call(app, 'POST', '/forms', { name: 'B', thanks_template_id: spolecna })).body[
        'data'
      ] as { id: string }
    ).id;

    const prehozeno = await call(app, 'PATCH', `/forms/${a}`, { thanks_template_id: jina });
    expect(prehozeno.status, JSON.stringify(prehozeno.body)).toBe(200);

    const readA = await call(app, 'GET', `/forms/${a}`);
    const readB = await call(app, 'GET', `/forms/${b}`);
    expect((readA.body['data'] as Record<string, unknown>)['thanks_template_id']).toBe(jina);
    // Tohle je jádro požadavku: druhý formulář si drží svoje.
    expect((readB.body['data'] as Record<string, unknown>)['thanks_template_id']).toBe(spolecna);
  });

  it('smějí mít každý jinou stránku od začátku', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const app = appFor(ws.ctx);
    const prvni = await seedTemplate(ws, 'page', 'První');
    const druha = await seedTemplate(ws, 'page', 'Druhá');

    const a = (
      (await call(app, 'POST', '/forms', { name: 'A', confirmed_template_id: prvni })).body[
        'data'
      ] as { id: string }
    ).id;
    const b = (
      (await call(app, 'POST', '/forms', { name: 'B', confirmed_template_id: druha })).body[
        'data'
      ] as { id: string }
    ).id;

    expect(
      ((await call(app, 'GET', `/forms/${a}`)).body['data'] as Record<string, unknown>)[
        'confirmed_template_id'
      ],
    ).toBe(prvni);
    expect(
      ((await call(app, 'GET', `/forms/${b}`)).body['data'] as Record<string, unknown>)[
        'confirmed_template_id'
      ],
    ).toBe(druha);
  });
});

describe('Seznam a odkaz na veřejnou stránku', () => {
  it('přijme tři návrhy druhu page a vydá je zpátky', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const app = appFor(ws.ctx);
    const page = await seedTemplate(ws, 'page', 'Hotovo');

    const created = await call(app, 'POST', '/lists', { name: `Seznam ${Date.now()}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body['data'] as { id: string }).id;

    const patched = await call(app, 'PATCH', `/lists/${id}`, {
      confirmed_template_id: page,
      already_subscribed_template_id: page,
      unsubscribed_template_id: page,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body['data']).toMatchObject({
      confirmed_template_id: page,
      already_subscribed_template_id: page,
      unsubscribed_template_id: page,
    });
  });

  it('odmítne e-mail místo stránky', async () => {
    const ws = await seedWorkspaceForCoreTests();
    const app = appFor(ws.ctx);
    const email = await seedTemplate(ws, 'campaign', 'Kampaň');

    const created = await call(app, 'POST', '/lists', { name: `Seznam ${Date.now()}` });
    const id = (created.body['data'] as { id: string }).id;

    const patched = await call(app, 'PATCH', `/lists/${id}`, { unsubscribed_template_id: email });
    expect(patched.status, JSON.stringify(patched.body)).toBe(422);
    expect(firstIssue(patched)).toEqual({
      path: 'unsubscribed_template_id',
      code: 'not_a_page_template',
    });
  });

  it('odmítne stránku z cizího projektu', async () => {
    const mine = await seedWorkspaceForCoreTests();
    const other = await seedWorkspaceForCoreTests();
    const app = appFor(mine.ctx);
    const foreign = await seedTemplate(other, 'page', 'Cizí stránka');

    const created = await call(app, 'POST', '/lists', { name: `Seznam ${Date.now()}` });
    const id = (created.body['data'] as { id: string }).id;

    const patched = await call(app, 'PATCH', `/lists/${id}`, { confirmed_template_id: foreign });
    expect(patched.status, JSON.stringify(patched.body)).toBe(422);
    expect(firstIssue(patched)).toEqual({
      path: 'confirmed_template_id',
      code: 'unknown_reference',
    });
  });
});
