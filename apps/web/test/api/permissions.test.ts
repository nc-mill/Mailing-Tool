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

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let viewer: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let secretKeyWithoutScope = '';
let publicKey = '';

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(registerAuthRoutes, registerApiKeyRoutes);

  owner = await seedOwnerWithWorkspace(app, 'owner');
  viewer = await seedOwnerWithWorkspace(app, 'viewer');

  const headers = {
    Cookie: owner.cookie,
    'X-Workspace-Id': owner.workspaceId,
    'Content-Type': 'application/json',
  };

  secretKeyWithoutScope = (
    await (
      await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'perm-key-001' },
        body: JSON.stringify({ name: 'Jen kontakty', kind: 'secret', scopes: ['contacts:read'] }),
      })
    ).json()
  ).secret;

  publicKey = (
    await (
      await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'perm-key-002' },
        body: JSON.stringify({ name: 'Web SDK', kind: 'public', scopes: [] }),
      })
    ).json()
  ).secret;
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
});

describe('kritérium 23: role bez oprávnění', () => {
  it('viewer dostane na zápisový endpoint 403 forbidden', async () => {
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Cookie: viewer.cookie,
        'X-Workspace-Id': viewer.workspaceId,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'perm-key-003',
      },
      body: JSON.stringify({ name: 'X', kind: 'secret', scopes: ['contacts:read'] }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });

  it('viewer nesmí ani číst klíče, protože api_keys:read má až admin', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Cookie: viewer.cookie, 'X-Workspace-Id': viewer.workspaceId },
    });
    expect(res.status).toBe(403);
  });

  it('chyba forbidden nese roli, potřebné oprávnění i role, které ho mají', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Cookie: viewer.cookie, 'X-Workspace-Id': viewer.workspaceId },
    });
    const body = await res.json();
    expect(body.params.requiredPermission).toBe('api_keys:read');
    expect(body.params.currentRole).toBe('viewer');
    expect(body.params.grantedByRoles).toEqual(['admin', 'owner']);
    // Viewer nemá members:read, takže seznam kolegů zůstává prázdný:
    // chyba nesmí být obchvat oprávnění.
    expect(body.params.contactableMembers).toEqual([]);
  });
});

describe('kritérium 24: API klíč bez scope', () => {
  it('klíč bez api_keys:write dostane 403 insufficient_scope, ne forbidden', async () => {
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKeyWithoutScope}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'perm-key-004',
      },
      body: JSON.stringify({ name: 'X', kind: 'secret', scopes: ['contacts:read'] }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('insufficient_scope');
  });
});

describe('kritérium 26: veřejný klíč na /api/v1/**', () => {
  it('vrací 403 insufficient_scope, ne 401, protože je to platný aktér bez scope', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${publicKey}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('insufficient_scope');
  });

  it('kritérium 26b: vadné tělo veřejného klíče vrací 401', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Authorization: 'Bearer ml_pub_aebagbaf' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('unauthenticated');
  });
});

describe('chybějící a neplatná autentizace', () => {
  it('bez hlavičky i bez cookie vrací 401', async () => {
    const res = await app.request('/api/v1/api-keys');
    expect(res.status).toBe(401);
  });

  it('session bez X-Workspace-Id vrací 404, protože není co izolovat', async () => {
    const res = await app.request('/api/v1/api-keys', { headers: { Cookie: owner.cookie } });
    expect(res.status).toBe(404);
  });
});
