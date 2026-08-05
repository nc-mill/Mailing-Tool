// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { closePools, withWorkspace } from '@mlain/core/tx';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerApiKeyRoutes } from '@mlain/core/identity/api/api-keys.routes';
import { registerTransactionalApiRoutes } from '@mlain/core/transactional/api';
import { createTemplate } from '@mlain/core/templates/service';
import { getFieldCatalog } from '@mlain/core/contacts';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';
import { seedOwnerWithWorkspace } from './helpers/seed';

/**
 * Celá cesta transakčního odeslání přes HTTP: klíč se scopem `transactional:send`,
 * povinná hlavička idempotence, odkaz z požadavku v tlačítku a zpráva v outboxu.
 *
 * Odeslání přes SES tady nekončí a končit nemůže: to dělá Go sender proti
 * skutečnému providerovi. Test dojde po `messages.status = 'pending'`, což je
 * přesně hranice, kterou vlastní aplikace.
 */

let harness: PgHarness;
let app: TestApp;

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let apiKey = '';
let keyWithoutScope = '';
let templateId = '';

const RESET_URL = 'https://shop.cz/reset?token=eyJhbGciOi&uid=8472';

function resetPasswordDesign() {
  return {
    schemaVersion: 1,
    meta: { name: 'Reset hesla', previewText: 'Nastavte si nové heslo', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [
          {
            id: 'b_000000000010',
            type: 'button',
            props: {
              ...blockDefaults('button'),
              label: [{ t: 'p', children: [{ t: 's', v: 'Nastavit nové heslo' }] }],
              // Odkaz PŘIJDE V POŽADAVKU. Tohle je celý smysl endpointu.
              href: '{{ data.reset_url }}',
              trackable: true,
            },
          },
          {
            id: 'b_000000000011',
            type: 'text',
            props: {
              ...blockDefaults('text'),
              content: [
                {
                  t: 'p',
                  children: [
                    { t: 's', v: 'Odkaz platí ' },
                    { t: 'var', expr: 'data.expires_in_minutes' },
                    { t: 's', v: ' minut.' },
                  ],
                },
              ],
            },
          },
          { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(
    registerAuthRoutes,
    registerApiKeyRoutes,
    registerTransactionalApiRoutes,
  );

  owner = await seedOwnerWithWorkspace(app, 'owner');
  const headers = {
    Cookie: owner.cookie,
    'X-Workspace-Id': owner.workspaceId,
    'Content-Type': 'application/json',
  };

  apiKey = (
    await (
      await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'tx-key-001' },
        body: JSON.stringify({
          name: 'Reset hesla',
          kind: 'secret',
          // Klíč v aplikaci zákazníka má JEDINÝ scope. Kdyby měl campaigns:send,
          // uměl by zastavit běžící rozesílku.
          scopes: ['transactional:send'],
        }),
      })
    ).json()
  ).secret;

  keyWithoutScope = (
    await (
      await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'tx-key-002' },
        body: JSON.stringify({ name: 'Jen kontakty', kind: 'secret', scopes: ['contacts:read'] }),
      })
    ).json()
  ).secret;

  const ctx = await createWorkspaceContext({
    kind: 'session',
    userId: owner.userId,
    workspaceRef: owner.workspaceId,
  });

  await withWorkspace(ctx, async (tx) => {
    const [provider] = await tx
      .insert(schema.sendingProviders)
      .values({
        workspaceId: owner.workspaceId,
        name: 'SMTP',
        type: 'smtp',
        configEncrypted: 'enc:v1:test',
        status: 'ready',
      })
      .returning({ id: schema.sendingProviders.id });
    await tx.insert(schema.campaigns).values({
      workspaceId: owner.workspaceId,
      name: 'Jarní novinky',
      status: 'draft',
      subject: 'Jaro je tady',
      fromName: 'Shop',
      fromEmail: 'noreply@shop.cz',
      providerId: provider!.id,
    });
  });

  const fields = await getFieldCatalog(ctx);
  const template = await createTemplate(
    { ctx, fields, userId: owner.userId },
    { name: 'Reset hesla', kind: 'transactional', document: resetPasswordDesign() as never },
  );
  templateId = template.id;
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
});

const post = (body: unknown, idempotencyKey: string, key = apiKey) =>
  app.request('/api/v1/transactional', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });

describe('POST /api/v1/transactional', () => {
  it('odešle reset hesla a odkaz z požadavku skončí v tlačítku', async () => {
    const res = await post(
      {
        template_id: templateId,
        to: { email: 'jan.novak@example.cz', name: 'Jan' },
        data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      },
      'tx-send-001',
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.message_id).toMatch(/^[0-9a-f-]{36}$/);

    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId: owner.userId,
      workspaceRef: owner.workspaceId,
    });
    const [message] = await withWorkspace(ctx, (tx) =>
      tx.select().from(schema.messages).where(eq(schema.messages.id, body.message_id)),
    );
    expect(message!.kind).toBe('transactional');
    expect(message!.status).toBe('pending');
    expect((message!.renderData as Record<string, Record<string, unknown>>)['data']).toEqual({
      reset_url: RESET_URL,
      expires_in_minutes: 30,
    });

    const [campaign] = await withWorkspace(ctx, (tx) =>
      tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, body.campaign_id)),
    );
    // Odkaz zůstává konstrukcí a dosadí ho až sender. Nikdy se nepřepíše na
    // trackovací značku, takže jednorázový token nemůže uniknout do statistik
    // ani ho nemůže spotřebovat bezpečnostní skener v poštovní schránce.
    expect(campaign!.compiledHtml).toContain('{{ data.reset_url');
    expect(campaign!.compiledHtml).not.toContain('track.mlain.invalid');
    expect(campaign!.trackOpens).toBe(false);
    expect(campaign!.trackClicks).toBe(false);
  });

  it('opakované volání s týmž klíčem druhý mail nepošle', async () => {
    const payload = {
      template_id: templateId,
      to: { email: 'opakovany@example.cz' },
      data: { reset_url: RESET_URL, expires_in_minutes: 30 },
    };
    const first = await post(payload, 'tx-send-repeat');
    const second = await post(payload, 'tx-send-repeat');
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.headers.get('Idempotent-Replay')).toBe('true');
    expect((await second.json()).message_id).toBe((await first.json()).message_id);
  });

  it('týž klíč s jiným tělem je 409, ne tichý přepis', async () => {
    await post(
      {
        template_id: templateId,
        to: { email: 'a@example.cz' },
        data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      },
      'tx-send-conflict',
    );
    const res = await post(
      {
        template_id: templateId,
        to: { email: 'b@example.cz' },
        data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      },
      'tx-send-conflict',
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('idempotency_key_reuse');
  });

  it('bez hlavičky Idempotency-Key to neprojde', async () => {
    const res = await app.request('/api/v1/transactional', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        to: { email: 'bezklice@example.cz' },
        data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('klíč bez scope transactional:send dostane 403 insufficient_scope', async () => {
    const res = await post(
      {
        template_id: templateId,
        to: { email: 'cizi@example.cz' },
        data: { reset_url: RESET_URL, expires_in_minutes: 30 },
      },
      'tx-send-scope',
      keyWithoutScope,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('insufficient_scope');
  });

  it('chybějící proměnná je 422, ne mail s prázdným odkazem', async () => {
    const res = await post(
      {
        template_id: templateId,
        to: { email: 'chybi@example.cz' },
        data: { expires_in_minutes: 30 },
      },
      'tx-send-missing',
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('transactional_variable_unknown');
    expect(body.params.paths).toEqual(['data.reset_url']);
    // RFC 9457: odpověď musí nést typ, instanci i request_id, ne jen kód.
    expect(body.type).toContain('transactional_variable_unknown');
    expect(body.instance).toBe('/api/v1/transactional');
    expect(body.request_id).toBeTruthy();
  });

  it('objekt data nad 16 kB je 413', async () => {
    const res = await post(
      {
        template_id: templateId,
        to: { email: 'velky@example.cz' },
        data: { reset_url: RESET_URL, expires_in_minutes: 30, padding: 'x'.repeat(17_000) },
      },
      'tx-send-large',
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('transactional_data_too_large');
  });
});
