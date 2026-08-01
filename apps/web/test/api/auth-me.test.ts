// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';

let harness: PgHarness;
let app: TestApp;

const PASSWORD = 'dostatecne-dlouhe-heslo';
let email = '';
let cookie = '';

beforeAll(async () => {
  harness = await startPgHarness();
  app = await createTestApp(registerAuthRoutes);

  email = `me-${Date.now()}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Petr',
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
});

describe('GET /api/v1/auth/me', () => {
  it('vrátí uživatele a jeho členství', async () => {
    const res = await app.request('/api/v1/auth/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(Array.isArray(body.memberships)).toBe(true);
  });

  it('bez cookie vrací 401', async () => {
    expect((await app.request('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('PATCH /api/v1/auth/me', () => {
  it('změní jméno a vrátí nový stav', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Petr Novák' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).user.name).toBe('Petr Novák');
  });

  it('chybějící klíč znamená neměnit, ne nastavit prázdno', async () => {
    await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'en' }),
    });
    const body = await (
      await app.request('/api/v1/auth/me', { headers: { Cookie: cookie } })
    ).json();
    expect(body.user.name).toBe('Petr Novák');
    expect(body.user.locale).toBe('en');
  });

  it('nepodporovaný jazyk vrací 422', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'kl' }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].path).toBe('locale');
  });

  it('neplatná časová zóna vrací 422', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'Mars/Olympus' }),
    });
    expect(res.status).toBe(422);
  });

  it('e-mail se přes tenhle endpoint měnit nedá', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jiny@example.cz' }),
    });
    expect(res.status).toBe(422);
  });
});
