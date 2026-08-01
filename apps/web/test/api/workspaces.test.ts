// @vitest-environment node
//
// Výchozí prostředí `apps/web` je jsdom. Pro databázové testy nejde použít,
// důvod je v komentáři `apps/web/test/api/pg-harness.ts`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closePools } from '@mlain/core/tx';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerWorkspaceRoutes } from '@mlain/core/identity/api/workspaces.routes';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';
import { seedOwnerWithWorkspace, TEST_PASSWORD } from './helpers/seed';

/**
 * ODCHYLKA OD PLÁNU: aplikace se staví až v `beforeAll` přes `createTestApp()`,
 * ne na úrovni modulu. Důvod je v `helpers/app.ts`.
 */
let harness: PgHarness;
let app: TestApp;

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let stranger: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(registerAuthRoutes, registerWorkspaceRoutes);

  owner = await seedOwnerWithWorkspace(app, 'owner');
  stranger = await seedOwnerWithWorkspace(app, 'owner');
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const asOwner = (extra: Record<string, string> = {}) => ({
  Cookie: owner.cookie,
  'X-Workspace-Id': owner.workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

describe('GET /api/v1/workspaces', () => {
  it('vrátí jen projekty, ve kterých má aktér členství', async () => {
    const body = await (
      await app.request('/api/v1/workspaces', { headers: { Cookie: owner.cookie } })
    ).json();
    const ids = body.data.map((w: { id: string }) => w.id);
    expect(ids).toContain(owner.workspaceId);
    expect(ids).not.toContain(stranger.workspaceId);
  });

  it('bez přihlášení vrací 401', async () => {
    expect((await app.request('/api/v1/workspaces')).status).toBe(401);
  });
});

describe('POST /api/v1/workspaces', () => {
  it('zakladatel se stává ownerem', async () => {
    const res = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        Cookie: owner.cookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'ws-key-001',
      },
      body: JSON.stringify({ name: 'Druhý projekt' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe('owner');
    expect(body.workspace.slug).toBe('druhy-projekt');
  });

  it('kolize slugu se řeší příponou, ne chybou', async () => {
    const first = await (
      await app.request('/api/v1/workspaces', {
        method: 'POST',
        headers: {
          Cookie: owner.cookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'ws-key-002',
        },
        body: JSON.stringify({ name: 'Stejný název' }),
      })
    ).json();
    const second = await (
      await app.request('/api/v1/workspaces', {
        method: 'POST',
        headers: {
          Cookie: owner.cookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'ws-key-003',
        },
        body: JSON.stringify({ name: 'Stejný název' }),
      })
    ).json();
    expect(first.workspace.slug).toBe('stejny-nazev');
    expect(second.workspace.slug).toBe('stejny-nazev-2');
  });
});

describe('PATCH /api/v1/workspaces/{id}', () => {
  it('owner smí měnit název a oslovení', async () => {
    const res = await app.request(`/api/v1/workspaces/${owner.workspaceId}`, {
      method: 'PATCH',
      headers: asOwner(),
      body: JSON.stringify({ name: 'Přejmenováno', address_form: 'informal' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspace.name).toBe('Přejmenováno');
    expect(body.workspace.address_form).toBe('informal');
  });

  it('neplatné oslovení vrací 422', async () => {
    const res = await app.request(`/api/v1/workspaces/${owner.workspaceId}`, {
      method: 'PATCH',
      headers: asOwner(),
      body: JSON.stringify({ address_form: 'polodruhe' }),
    });
    expect(res.status).toBe(422);
  });

  it('cizí projekt vrací 404', async () => {
    const res = await app.request(`/api/v1/workspaces/${stranger.workspaceId}`, {
      method: 'PATCH',
      headers: {
        Cookie: owner.cookie,
        'X-Workspace-Id': stranger.workspaceId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Podvrh' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE a restore', () => {
  it('smazání vyžaduje opsání názvu projektu', async () => {
    const target = await seedOwnerWithWorkspace(app, 'owner');
    const wrong = await app.request(`/api/v1/workspaces/${target.workspaceId}`, {
      method: 'DELETE',
      headers: {
        Cookie: target.cookie,
        'X-Workspace-Id': target.workspaceId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm_name: 'Něco jiného' }),
    });
    expect(wrong.status).toBe(422);
  });

  it('se správným názvem projekt měkce smaže a jde do 30 dnů obnovit', async () => {
    const target = await seedOwnerWithWorkspace(app, 'owner');
    const headers = {
      Cookie: target.cookie,
      'X-Workspace-Id': target.workspaceId,
      'Content-Type': 'application/json',
    };

    const del = await app.request(`/api/v1/workspaces/${target.workspaceId}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ confirm_name: 'Seed' }),
    });
    expect(del.status).toBe(204);

    // Smazaný projekt už není dostupný běžnou cestou.
    expect(
      (await app.request('/api/v1/workspaces/' + target.workspaceId, { headers })).status,
    ).toBe(404);

    const restored = await app.request(`/api/v1/workspaces/${target.workspaceId}/restore`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'ws-restore-001' },
      body: JSON.stringify({}),
    });
    expect(restored.status).toBe(200);
    expect(
      (await app.request('/api/v1/workspaces/' + target.workspaceId, { headers })).status,
    ).toBe(200);
  });
});

describe('POST /api/v1/workspaces/{id}/transfer-ownership', () => {
  it('bez X-Reauth-Password vrací 401', async () => {
    const res = await app.request(`/api/v1/workspaces/${owner.workspaceId}/transfer-ownership`, {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'ws-transfer-001' }),
      body: JSON.stringify({ user_id: stranger.userId }),
    });
    expect(res.status).toBe(401);
  });

  it('cílový uživatel musí být členem, jinak 422', async () => {
    const res = await app.request(`/api/v1/workspaces/${owner.workspaceId}/transfer-ownership`, {
      method: 'POST',
      headers: asOwner({
        'Idempotency-Key': 'ws-transfer-002',
        'X-Reauth-Password': TEST_PASSWORD,
      }),
      body: JSON.stringify({ user_id: stranger.userId }),
    });
    expect(res.status).toBe(422);
  });
});
