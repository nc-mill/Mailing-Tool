// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePools } from '@mlain/core/tx';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerApiKeyRoutes } from '@mlain/core/identity/api/api-keys.routes';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';
import { seedOwnerWithWorkspace } from './helpers/seed';

let harness: PgHarness;
let app: TestApp;

let cookie = '';
let workspaceId = '';

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(registerAuthRoutes, registerApiKeyRoutes);

  const seeded = await seedOwnerWithWorkspace(app);
  cookie = seeded.cookie;
  workspaceId = seeded.workspaceId;
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
});

const headers = (extra: Record<string, string> = {}) => ({
  Cookie: cookie,
  'X-Workspace-Id': workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

const createKey = (body: unknown, idempotencyKey: string) =>
  app.request('/api/v1/api-keys', {
    method: 'POST',
    headers: headers({ 'Idempotency-Key': idempotencyKey }),
    body: JSON.stringify(body),
  });

describe('POST /api/v1/api-keys', () => {
  it('kritérium 25: sekret je v odpovědi právě jednou', async () => {
    const res = await createKey(
      { name: 'CI', kind: 'secret', scopes: ['contacts:read'] },
      'idem-key-001',
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toMatch(/^ml_live_[a-z2-7]{8}_[A-Za-z0-9_-]{43}$/);

    const list = await (await app.request('/api/v1/api-keys', { headers: headers() })).json();
    expect(JSON.stringify(list)).not.toContain(body.secret);
    expect(list.data.every((k: Record<string, unknown>) => !('secret' in k))).toBe(true);
  });

  it('kritérium 30: stejný Idempotency-Key a stejné tělo vytvoří jeden zdroj', async () => {
    const body = { name: 'Idem', kind: 'secret', scopes: ['contacts:read'] };
    const first = await createKey(body, 'idem-key-002');
    const second = await createKey(body, 'idem-key-002');
    expect(second.status).toBe(201);
    expect(second.headers.get('Idempotent-Replay')).toBe('true');
    expect((await second.json()).key.id).toBe((await first.json()).key.id);
  });

  it('kritérium 31: stejný klíč s jiným tělem vrací 409 idempotency_key_reuse', async () => {
    await createKey({ name: 'A', kind: 'secret', scopes: ['contacts:read'] }, 'idem-key-003');
    const res = await createKey(
      { name: 'B', kind: 'secret', scopes: ['contacts:read'] },
      'idem-key-003',
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('idempotency_key_reuse');
  });

  it('chybějící Idempotency-Key vrací 422 s cestou Idempotency-Key', async () => {
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'X', kind: 'secret', scopes: ['contacts:read'] }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].path).toBe('Idempotency-Key');
  });

  it('neznámý scope vrací 422', async () => {
    const res = await createKey(
      { name: 'X', kind: 'secret', scopes: ['neexistuje:cokoliv'] },
      'idem-key-004',
    );
    expect(res.status).toBe(422);
  });

  it('wildcard scope se odmítne', async () => {
    const res = await createKey({ name: 'X', kind: 'secret', scopes: ['*'] }, 'idem-key-005');
    expect(res.status).toBe(422);
  });

  it('veřejný klíč dostane pevně events:write', async () => {
    const res = await createKey({ name: 'Web', kind: 'public', scopes: [] }, 'idem-key-006');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toMatch(/^ml_pub_[a-z2-7]{16}$/);
    expect(body.key.scopes).toEqual(['events:write']);
  });
});

describe('POST /api/v1/api-keys/{id}/rotate', () => {
  it('kritérium 26c: sekret s grace_seconds=60 platí i po rotaci a nese ML-Key-Rotated', async () => {
    // ODCHYLKA OD PLÁNU: klíč se zakládá se scope `api_keys:read`, ne
    // `contacts:read`. Test se jím pak sám ptá na výpis klíčů, a s původním
    // scope by dostal 403 insufficient_scope; padal by na oprávnění místo
    // na tom, co měří, tedy na platnosti sekretu po rotaci.
    const created = await (
      await createKey({ name: 'Rot', kind: 'secret', scopes: ['api_keys:read'] }, 'idem-key-007')
    ).json();
    const oldSecret = created.secret;

    const rotated = await app.request(`/api/v1/api-keys/${created.key.id}/rotate`, {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'idem-key-008' }),
      body: JSON.stringify({ grace_seconds: 60 }),
    });
    expect(rotated.status).toBe(200);
    const newSecret = (await rotated.json()).secret;
    expect(newSecret).not.toBe(oldSecret);

    // Nový sekret platí bez příznaku rotace.
    const withNew = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${newSecret}` },
    });
    expect(withNew.status).toBe(200);
    expect(withNew.headers.get('ML-Key-Rotated')).toBeNull();

    // Dožívající sekret v grace období platí taky a nese příznak rotace.
    const withOld = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${oldSecret}` },
    });
    expect(withOld.status).toBe(200);
    expect(withOld.headers.get('ML-Key-Rotated')).toBe('true');
  });

  it('rotace veřejného klíče vrací 409, protože žádný sekret nenese', async () => {
    const created = await (
      await createKey({ name: 'Pub', kind: 'public', scopes: [] }, 'idem-key-009')
    ).json();
    const res = await app.request(`/api/v1/api-keys/${created.key.id}/rotate`, {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'idem-key-010' }),
      body: JSON.stringify({ grace_seconds: 0 }),
    });
    expect(res.status).toBe(409);
  });

  it('grace_seconds nad 86400 vrací 422', async () => {
    const created = await (
      await createKey({ name: 'Rot2', kind: 'secret', scopes: ['contacts:read'] }, 'idem-key-011')
    ).json();
    const res = await app.request(`/api/v1/api-keys/${created.key.id}/rotate`, {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'idem-key-012' }),
      body: JSON.stringify({ grace_seconds: 86401 }),
    });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/api-keys/{id}', () => {
  it('revokuje klíč, který pak neprojde ověřením', async () => {
    const created = await (
      await createKey({ name: 'Del', kind: 'secret', scopes: ['api_keys:read'] }, 'idem-key-013')
    ).json();

    const before = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${created.secret}` },
    });
    expect(before.status).toBe(200);

    const res = await app.request(`/api/v1/api-keys/${created.key.id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);

    const after = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${created.secret}` },
    });
    expect(after.status).toBe(401);
  });

  it('cizí id vrací 404', async () => {
    const res = await app.request('/api/v1/api-keys/0192f3a0-1c2d-7e44-8d4e-5f6071829999', {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(404);
  });
});
