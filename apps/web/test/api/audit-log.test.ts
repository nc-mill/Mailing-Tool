// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePools } from '@mlain/core/tx';
import { startPgHarness, type PgHarness } from './pg-harness';
import { seedOwnerWithWorkspace } from './helpers/seed';
import type { TestApp } from './helpers/app';

/**
 * ODCHYLKA OD PLÁNU: aplikace se staví `buildApp()` až v `beforeAll`, ne na
 * úrovni modulu. Důvod je tentýž jako u `helpers/app.ts`: `rate-limit.ts` čte
 * konfiguraci už při vyhodnocení modulu a prostředí nastavuje až harness.
 */
let harness: PgHarness;
let app: TestApp;
let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let viewer: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;

const headers = (extra: Record<string, string> = {}) => ({
  Cookie: owner.cookie,
  'X-Workspace-Id': owner.workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  const { buildApp } = await import('../../src/lib/api/openapi');
  app = buildApp();

  owner = await seedOwnerWithWorkspace(app, 'owner');
  viewer = await seedOwnerWithWorkspace(app, 'viewer');

  await app.request('/api/v1/api-keys', {
    method: 'POST',
    headers: headers({ 'Idempotency-Key': 'audit-key-001' }),
    body: JSON.stringify({ name: 'Audit', kind: 'secret', scopes: ['contacts:read'] }),
  });
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('GET /api/v1/audit-log', () => {
  it('vrátí stránku záznamů s kurzorem', async () => {
    const res = await app.request('/api/v1/audit-log?limit=10', { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toHaveProperty('has_more');
    expect(body.data.some((e: { action: string }) => e.action === 'api_key.created')).toBe(true);
  });

  it('kritérium 21c: nevrací globální řádky bez workspace_id', async () => {
    const body = await (
      await app.request('/api/v1/audit-log?limit=200', { headers: headers() })
    ).json();
    expect(body.data.some((e: { action: string }) => e.action === 'user.login')).toBe(false);
  });

  it('viewer nemá audit:read a dostane 403', async () => {
    const res = await app.request('/api/v1/audit-log', {
      headers: { Cookie: viewer.cookie, 'X-Workspace-Id': viewer.workspaceId },
    });
    expect(res.status).toBe(403);
  });

  it('nepovolené řazení vrací 422', async () => {
    const res = await app.request('/api/v1/audit-log?order=action.asc', { headers: headers() });
    expect(res.status).toBe(422);
  });

  it('limit nad 200 vrací 422', async () => {
    const res = await app.request('/api/v1/audit-log?limit=500', { headers: headers() });
    expect(res.status).toBe(422);
  });

  it('metadata neobsahují sekret vytvořeného klíče', async () => {
    const body = await (
      await app.request('/api/v1/audit-log?limit=50', { headers: headers() })
    ).json();
    expect(JSON.stringify(body)).not.toContain('ml_live_');
  });
});

describe('GET /api/v1/audit-log/count', () => {
  it('vrací počet se stejnými filtry', async () => {
    const res = await app.request('/api/v1/audit-log/count?action=api_key.created', {
      headers: headers(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.precision).toBe('exact');
    expect(body.stale).toBe(false);
  });
});

describe('GET /api/v1/webhook-deliveries', () => {
  it('vrací prázdnou stránku, když žádná doručení nejsou', async () => {
    const res = await app.request('/api/v1/webhook-deliveries', { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.has_more).toBe(false);
  });

  it('count vrací nulu', async () => {
    const body = await (
      await app.request('/api/v1/webhook-deliveries/count', { headers: headers() })
    ).json();
    expect(body.count).toBe(0);
  });
});
