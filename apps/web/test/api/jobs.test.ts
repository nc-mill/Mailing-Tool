// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearJobSources, registerJobSource } from '@mlain/core/platform/jobs/registry';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerJobRoutes } from '@mlain/core/platform/api/jobs.routes';
import { closePools } from '@mlain/core/tx';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';
import { seedOwnerWithWorkspace } from './helpers/seed';

/**
 * ODCHYLKA OD PLÁNU: aktér se seeduje `seedOwnerWithWorkspace` z `helpers/seed`,
 * ne `seedWorkspaceAndLogin` z neexistujícího `./helpers.js`, a kontext projektu
 * se předává hlavičkou `X-Workspace-Id`, protože cesta `/api/v1/jobs` slug
 * v URL nenese. Bez hlavičky by middleware neměl podle čeho kontext sestavit.
 */
let harness: PgHarness;
let app: TestApp;
let cookie = '';
let workspaceId = '';

const headers = () => ({ Cookie: cookie, 'X-Workspace-Id': workspaceId });

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(registerAuthRoutes, registerJobRoutes);
  const seeded = await seedOwnerWithWorkspace(app, 'admin');
  cookie = seeded.cookie;
  workspaceId = seeded.workspaceId;
}, 180_000);

afterAll(async () => {
  clearJobSources();
  await closePools();
  await harness?.stop();
}, 120_000);

describe('GET /api/v1/jobs', () => {
  it('bez registrovaného zdroje vrací prázdný seznam a nulový odznak', async () => {
    clearJobSources();
    const res = await app.request('/api/v1/jobs', { headers: headers() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], running_count: 0 });
  });

  it('vrátí úlohy zaregistrovaného zdroje a spočítá jen běžící', async () => {
    clearJobSources();
    registerJobSource({
      kind: 'import',
      list: async () => [
        {
          id: 'a',
          kind: 'import',
          title: 'Import',
          status: 'running',
          done: 1,
          total: 4,
          startedBy: 'Petr',
          startedAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:05:00.000Z',
          finishedAt: null,
          note: null,
        },
        {
          id: 'b',
          kind: 'import',
          title: 'Import',
          status: 'completed',
          done: 4,
          total: 4,
          startedBy: 'Petr',
          startedAt: '2026-08-01T09:00:00.000Z',
          updatedAt: '2026-08-01T09:30:00.000Z',
          finishedAt: '2026-08-01T09:30:00.000Z',
          note: null,
        },
      ],
      get: async () => null,
    });
    const body = await (await app.request('/api/v1/jobs', { headers: headers() })).json();
    expect(body.data.map((j: { id: string }) => j.id)).toEqual(['a', 'b']);
    expect(body.running_count).toBe(1);
    expect(body.data[0].started_by).toBe('Petr');
  });

  it('neznámý druh v detailu vrací 404, ne 500', async () => {
    clearJobSources();
    const res = await app.request('/api/v1/jobs/neznamy/xyz', { headers: headers() });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('bez přihlášení vrací 401', async () => {
    const res = await app.request('/api/v1/jobs');
    expect(res.status).toBe(401);
  });
});
