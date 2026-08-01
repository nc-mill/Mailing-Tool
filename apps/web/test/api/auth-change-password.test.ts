// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';

let harness: PgHarness;
let app: TestApp;

const OLD = 'stare-dostatecne-dlouhe';
const NEW = 'nove-dostatecne-dlouhe';
let email = '';

async function signIn(password: string): Promise<string> {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}

beforeAll(async () => {
  harness = await startPgHarness();
  app = await createTestApp(registerAuthRoutes);
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
});

beforeEach(async () => {
  email = `chp-api-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(OLD),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('kritérium 21b: uspěje a heslo je po volání opravdu změněné', async () => {
    const cookie = await signIn(OLD);
    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: OLD, new_password: NEW }),
    });
    expect(res.status).toBe(204);

    const withNew = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: NEW }),
    });
    expect(withNew.status).toBe(200);
  });

  it('kritérium 17: request se starou cookie z jiné relace vrátí 401 session_expired', async () => {
    const other = await signIn(OLD);
    const current = await signIn(OLD);

    await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: current, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: OLD, new_password: NEW }),
    });

    const res = await app.request('/api/v1/auth/me', { headers: { Cookie: other } });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('session_expired');
  });

  it('aktuální relace zůstává platná, uživatel se nevyhodí sám', async () => {
    const current = await signIn(OLD);
    await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: current, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: OLD, new_password: NEW }),
    });
    expect((await app.request('/api/v1/auth/me', { headers: { Cookie: current } })).status).toBe(
      200,
    );
  });

  it('špatné současné heslo vrací 401', async () => {
    const cookie = await signIn(OLD);
    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: 'uplne-jine-heslo', new_password: NEW }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('invalid_credentials');
  });
});
