// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';

/**
 * Odchylky od plánu jsou stejné jako v `auth-login.test.ts`: aplikace se staví
 * až po startu harnessu a každé přihlášení jde z jiné adresy, aby pravidlo
 * `login_ip_email` (pět pokusů na dvojici IP a e-mail) neshodilo test, který
 * se přihlašuje devětkrát na jeden účet.
 */
let harness: PgHarness;
let app: TestApp;

const PASSWORD = 'dostatecne-dlouhe-heslo';
let email = '';
let ipCounter = 0;

async function signInAs(address: string): Promise<string> {
  ipCounter += 1;
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.30.0.${ipCounter}` },
    body: JSON.stringify({ email: address, password: PASSWORD }),
  });
  const cookie = res.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0]!;
}

const signIn = () => signInAs(email);

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  app = await createTestApp(registerAuthRoutes);

  email = `sessions-${Date.now()}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Petr',
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
});

describe('GET /api/v1/auth/sessions', () => {
  it('vypíše aktivní relace a označí aktuální', async () => {
    const cookie = await signIn();
    const res = await app.request('/api/v1/auth/sessions', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it('bez cookie vrací 401 unauthenticated', async () => {
    const res = await app.request('/api/v1/auth/sessions');
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('unauthenticated');
  });

  it('nikdy nevrací token ani jeho hash', async () => {
    const cookie = await signIn();
    const body = await (
      await app.request('/api/v1/auth/sessions', { headers: { Cookie: cookie } })
    ).json();
    expect(JSON.stringify(body)).not.toContain('token');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('vrátí 204, smaže cookie a relace přestane platit', async () => {
    const cookie = await signIn();
    const res = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = await app.request('/api/v1/auth/sessions', { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
    expect((await after.json()).code).toBe('session_expired');
  });
});

describe('POST /api/v1/auth/logout-all', () => {
  it('kritérium 18: i aktuální cookie přestane platit', async () => {
    const first = await signIn();
    const second = await signIn();

    const res = await app.request('/api/v1/auth/logout-all', {
      method: 'POST',
      headers: { Cookie: second },
    });
    expect(res.status).toBe(204);

    for (const cookie of [first, second]) {
      const check = await app.request('/api/v1/auth/sessions', { headers: { Cookie: cookie } });
      expect(check.status).toBe(401);
      expect((await check.json()).code).toBe('session_expired');
    }
  });
});

describe('DELETE /api/v1/auth/sessions/{id}', () => {
  it('zruší vlastní relaci', async () => {
    const keep = await signIn();
    const doomed = await signIn();
    const list = await (
      await app.request('/api/v1/auth/sessions', { headers: { Cookie: doomed } })
    ).json();
    const current = list.data.find((s: { current: boolean }) => s.current);

    const res = await app.request(`/api/v1/auth/sessions/${current.id}`, {
      method: 'DELETE',
      headers: { Cookie: keep },
    });
    expect(res.status).toBe(204);

    const check = await app.request('/api/v1/auth/sessions', { headers: { Cookie: doomed } });
    expect(check.status).toBe(401);
  });

  it('cizí relace vrací 404, ne 403', async () => {
    const otherEmail = `other-${Date.now()}@example.cz`;
    await withoutContext(async (tx) => {
      await tx.insert(schema.users).values({
        email: otherEmail,
        passwordHash: await hashPassword(PASSWORD),
        locale: 'cs',
        timezone: 'Europe/Prague',
      });
    });
    const mine = await signIn();
    const foreignCookie = await signInAs(otherEmail);
    const foreignList = await (
      await app.request('/api/v1/auth/sessions', { headers: { Cookie: foreignCookie } })
    ).json();
    const foreignId = foreignList.data[0].id;

    const res = await app.request(`/api/v1/auth/sessions/${foreignId}`, {
      method: 'DELETE',
      headers: { Cookie: mine },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });

  it('neplatné UUID v cestě vrací 422, ne 500', async () => {
    const cookie = await signIn();
    const res = await app.request('/api/v1/auth/sessions/neni-uuid', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(422);
  });
});
