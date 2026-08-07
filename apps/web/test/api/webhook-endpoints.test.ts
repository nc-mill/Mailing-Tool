// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { closePools, withWorkspace } from '@mlain/core/tx';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerWebhookEndpointRoutes } from '@mlain/core/platform/api/webhooks.routes';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';
import { seedOwnerWithWorkspace } from './helpers/seed';

let harness: PgHarness;
let app: TestApp;

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;

const headers = (extra: Record<string, string> = {}) => ({
  Cookie: owner.cookie,
  'X-Workspace-Id': owner.workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(registerAuthRoutes, registerWebhookEndpointRoutes);

  owner = await seedOwnerWithWorkspace(app, 'owner');
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('POST /api/v1/webhook-endpoints', () => {
  it('vytvoří endpoint a vrátí secret právě jednou', async () => {
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-001' }),
      body: JSON.stringify({
        url: 'https://example.com/hook',
        event_types: ['contact.subscribed'],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

    const list = await (
      await app.request('/api/v1/webhook-endpoints', { headers: headers() })
    ).json();
    expect(JSON.stringify(list)).not.toContain(body.secret);
    expect(JSON.stringify(list)).not.toContain('secret_encrypted');
  });

  it('kritérium 39: webhook na 169.254.169.254 se neuloží', async () => {
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-002' }),
      body: JSON.stringify({ url: 'http://169.254.169.254/', event_types: ['contact.subscribed'] }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].code).toBe('blocked_target');
  });

  it('http adresa se odmítne, webhooky jezdí jen po https', async () => {
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-003' }),
      body: JSON.stringify({ url: 'http://example.com/hook', event_types: ['contact.subscribed'] }),
    });
    expect(res.status).toBe(422);
  });

  it('prázdný seznam typů událostí se odmítne', async () => {
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-004' }),
      body: JSON.stringify({ url: 'https://example.com/hook', event_types: [] }),
    });
    expect(res.status).toBe(422);
  });

  it('neznámý typ události se odmítne a odpověď nese seznam platných', async () => {
    // Do dneška prošlo cokoli. Kdo se překlepl, uložil si odběr, který se
    // s ničím nespáruje, a poznal to jedině tak, že mu nikdy nic nedorazilo.
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-unknown' }),
      body: JSON.stringify({
        url: 'https://example.com/hook',
        event_types: ['contact.subscribe'],
      }),
    });
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.errors[0].code).toBe('unknown_event_type');
    expect(body.errors[0].message).toContain('contact.subscribed');
    expect(body.params.allowed_event_types).toContain('message.opened');
    expect(body.params.suggestions['contact.subscribe']).toBe('contact.subscribed');
  });

  it('typ, který rozhraní nabízelo v MVP0, se pořád uloží', async () => {
    // Zpětná slučitelnost: `contact.created` nikdo nevydává a nabídka ho už
    // nemá, ale zápis ho přijímá, aby endpointy z té doby šly dál upravovat.
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-retired' }),
      body: JSON.stringify({
        url: 'https://example.com/hook-retired',
        event_types: ['contact.created'],
      }),
    });
    expect(res.status).toBe(201);
  });

  it('víc než 20 endpointů na projekt se odmítne', async () => {
    for (let i = 0; i < 19; i += 1) {
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: headers({ 'Idempotency-Key': `wh-bulk-${i}` }),
        body: JSON.stringify({
          url: `https://example.com/hook-${i}`,
          event_types: ['contact.subscribed'],
        }),
      });
    }
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-over' }),
      body: JSON.stringify({
        url: 'https://example.com/hook-over',
        event_types: ['contact.subscribed'],
      }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).params.reason).toBe('too_many_endpoints');
  });
});

describe('PATCH a DELETE', () => {
  it('změna na blokovanou adresu se odmítne', async () => {
    // Vlastní projekt, aby se nepotkal s limitem 20 endpointů z testu výš.
    const other = await seedOwnerWithWorkspace(app, 'owner');
    const otherHeaders = {
      Cookie: other.cookie,
      'X-Workspace-Id': other.workspaceId,
      'Content-Type': 'application/json',
    };
    const created = await (
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: { ...otherHeaders, 'Idempotency-Key': 'wh-key-005' },
        body: JSON.stringify({
          url: 'https://example.com/patch',
          event_types: ['contact.subscribed'],
        }),
      })
    ).json();

    const res = await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}`, {
      method: 'PATCH',
      headers: otherHeaders,
      body: JSON.stringify({ url: 'https://127.0.0.1/hook' }),
    });
    expect(res.status).toBe(422);
  });

  it('změna na neznámý typ události se odmítne', async () => {
    const other = await seedOwnerWithWorkspace(app, 'owner');
    const otherHeaders = {
      Cookie: other.cookie,
      'X-Workspace-Id': other.workspaceId,
      'Content-Type': 'application/json',
    };
    const created = await (
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: { ...otherHeaders, 'Idempotency-Key': 'wh-key-patch-unknown' },
        body: JSON.stringify({
          url: 'https://example.com/patch-typy',
          event_types: ['contact.subscribed'],
        }),
      })
    ).json();

    const res = await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}`, {
      method: 'PATCH',
      headers: otherHeaders,
      body: JSON.stringify({ event_types: ['contact.subscribed', 'message.open'] }),
    });
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.params.unknown_event_types).toEqual(['message.open']);
    expect(body.params.suggestions['message.open']).toBe('message.opened');
  });

  it('smazaný endpoint zmizí ze seznamu a detail vrací 404', async () => {
    const other = await seedOwnerWithWorkspace(app, 'owner');
    const otherHeaders = {
      Cookie: other.cookie,
      'X-Workspace-Id': other.workspaceId,
      'Content-Type': 'application/json',
    };
    const created = await (
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: { ...otherHeaders, 'Idempotency-Key': 'wh-key-006' },
        body: JSON.stringify({
          url: 'https://example.com/smazat',
          event_types: ['contact.subscribed'],
        }),
      })
    ).json();

    expect(
      (
        await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}`, {
          method: 'DELETE',
          headers: otherHeaders,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}`, {
          headers: otherHeaders,
        })
      ).status,
    ).toBe(404);
  });

  /**
   * TESTOVACÍ UDÁLOST NESMÍ ZÁVISET NA ODBĚRU.
   *
   * Tlačítko míří na KONKRÉTNÍ endpoint, takže mu má dorazit bez ohledu na to,
   * co odebírá. Do 7. 8. cesta jen zapsala řádek do `webhook_events` a tím to
   * skončilo: fan-out se nezařazoval, takže doručení nevzniklo ANI JEDNO,
   * ačkoli odpověď 202 tvrdila „zařazeno k doručení".
   */
  it('testovací událost dorazí endpointu, který nic takového neodebírá', async () => {
    const other = await seedOwnerWithWorkspace(app, 'owner');
    const otherHeaders = {
      Cookie: other.cookie,
      'X-Workspace-Id': other.workspaceId,
      'Content-Type': 'application/json',
    };
    const created = await (
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: { ...otherHeaders, 'Idempotency-Key': 'wh-key-test-event' },
        body: JSON.stringify({
          url: 'https://example.com/hook-test',
          event_types: ['contact.subscribed'],
        }),
      })
    ).json();

    const res = await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}/test`, {
      method: 'POST',
      headers: { ...otherHeaders, 'Idempotency-Key': 'wh-key-test-fire' },
      body: '{}',
    });
    expect(res.status).toBe(202);
    const { event_id: eventId } = await res.json();

    const ctx = await createWorkspaceContext({
      kind: 'session',
      userId: other.userId,
      workspaceRef: other.workspaceId,
    });
    const deliveries = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ endpoint_id: string; event_type: string }>(sql`
        SELECT endpoint_id::text AS endpoint_id, event_type
          FROM webhook_deliveries WHERE event_id = ${eventId}::uuid
      `);
      return rows;
    });
    expect(deliveries, 'testovací událost nevyrobila žádné doručení').toHaveLength(1);
    expect(deliveries[0]!.endpoint_id).toBe(created.endpoint.id);
    expect(deliveries[0]!.event_type).toBe('webhook.ping');
  });

  it('cizí projekt endpoint nevidí', async () => {
    const other = await seedOwnerWithWorkspace(app, 'owner');
    const otherHeaders = {
      Cookie: other.cookie,
      'X-Workspace-Id': other.workspaceId,
      'Content-Type': 'application/json',
    };
    const created = await (
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: { ...otherHeaders, 'Idempotency-Key': 'wh-key-007' },
        body: JSON.stringify({
          url: 'https://example.com/cizi',
          event_types: ['contact.subscribed'],
        }),
      })
    ).json();

    // Vlastník jiného projektu se ptá na cizí ID pod SVÝM kontextem: musí
    // dostat 404, ne 403, aby z odpovědi nešlo zjistit, že endpoint existuje.
    const res = await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}`, {
      headers: headers(),
    });
    expect(res.status).toBe(404);
  });
});
