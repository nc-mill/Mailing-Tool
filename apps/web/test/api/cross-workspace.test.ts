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

let a: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let b: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let keyOfB = '';
let keyIdInA = '';

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(registerAuthRoutes, registerApiKeyRoutes);

  a = await seedOwnerWithWorkspace(app, 'owner');
  b = await seedOwnerWithWorkspace(app, 'owner');

  const created = await (
    await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Cookie: a.cookie,
        'X-Workspace-Id': a.workspaceId,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'xws-key-001',
      },
      body: JSON.stringify({ name: 'Klíč projektu A', kind: 'secret', scopes: ['api_keys:read'] }),
    })
  ).json();
  keyIdInA = created.key.id;

  keyOfB = (
    await (
      await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: {
          Cookie: b.cookie,
          'X-Workspace-Id': b.workspaceId,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'xws-key-002',
        },
        body: JSON.stringify({
          name: 'Klíč projektu B',
          kind: 'secret',
          scopes: ['api_keys:read', 'api_keys:write'],
        }),
      })
    ).json()
  ).secret;
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
});

describe('kritérium 19: klíč projektu B na zdroj z projektu A', () => {
  it('vrátí 404 s application/problem+json a code not_found', async () => {
    const res = await app.request(`/api/v1/api-keys/${keyIdInA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${keyOfB}` },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()).code).toBe('not_found');
  });

  it('výpis pod klíčem projektu B neobsahuje ani jeden klíč projektu A', async () => {
    const body = await (
      await app.request('/api/v1/api-keys', { headers: { Authorization: `Bearer ${keyOfB}` } })
    ).json();
    expect(body.data.some((k: { id: string }) => k.id === keyIdInA)).toBe(false);
  });

  it('workspace se bere z klíče, hlavička X-Workspace-Id ho nepřepíše', async () => {
    const body = await (
      await app.request('/api/v1/api-keys', {
        headers: { Authorization: `Bearer ${keyOfB}`, 'X-Workspace-Id': a.workspaceId },
      })
    ).json();
    expect(body.data.some((k: { id: string }) => k.id === keyIdInA)).toBe(false);
  });
});

describe('nečlen se session', () => {
  it('cizí workspace v hlavičce vrací 404, ne 403 (ochrana proti enumeraci ID)', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Cookie: b.cookie, 'X-Workspace-Id': a.workspaceId },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });

  it('neexistující workspace vrací tentýž kód, aby se odpovědi nedaly rozlišit', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Cookie: b.cookie, 'X-Workspace-Id': '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6099' },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });
});
