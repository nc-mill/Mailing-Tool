// @vitest-environment node
//
// Výchozí prostředí `apps/web` je jsdom. Pro databázové testy nejde použít,
// důvod je v komentáři `apps/web/test/api/pg-harness.ts`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';

/**
 * ODCHYLKY OD PLÁNU, obě vynucené skutečným chováním, ne pohodlím:
 *
 * 1. Aplikace se staví AŽ v `beforeAll` přes `createTestApp()`, ne na úrovni
 *    modulu. Důvod je v `helpers/app.ts`.
 *
 * 2. Každý request nese vlastní `X-Forwarded-For` a `TRUST_PROXY` je 1.
 *    Pravidlo `login_ip_email` z tabulky 4.5 povoluje PĚT pokusů na dvojici
 *    (IP, e-mail) za 300 s, ale tenhle soubor jich na jeden účet posílá sedm.
 *    Se sdílenou adresou by šestý dostal 429 a test by padal na rate limitu
 *    místo na tom, co měří. Rozlišené adresy jsou přesnější model reality:
 *    sedm pokusů z jedné adresy je útok, sedm z různých je sedm zařízení.
 */
let harness: PgHarness;
let app: TestApp;

const PASSWORD = 'dostatecne-dlouhe-heslo';
let email = '';
let ipCounter = 0;

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';

  app = await createTestApp(registerAuthRoutes);

  email = `api-login-${Date.now()}@example.cz`;
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

const post = (body: unknown, headers: Record<string, string> = {}) => {
  ipCounter += 1;
  return app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.20.0.${ipCounter}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
};

describe('POST /api/v1/auth/login', () => {
  it('kritérium 14: nastaví cookie ml_session s HttpOnly a SameSite=Lax', async () => {
    const res = await post({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('ml_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('Secure se nastaví, jen když APP_URL začíná https', async () => {
    const cookie = (await post({ email, password: PASSWORD })).headers.get('set-cookie') ?? '';
    const expectSecure = process.env['APP_URL']?.startsWith('https://') ?? false;
    expect(cookie.includes('Secure')).toBe(expectSecure);
  });

  it('vrátí uživatele a jeho projekty, nikdy hash hesla', async () => {
    const body = await (await post({ email, password: PASSWORD })).json();
    expect(body.user.email).toBe(email);
    expect(Array.isArray(body.workspaces)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('špatné heslo vrací 401 problem+json s kódem invalid_credentials', async () => {
    const res = await post({ email, password: 'uplne-jine-heslo' });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()).code).toBe('invalid_credentials');
  });

  it('neznámý klíč v těle vrací 422, ne 200 (kritérium 28)', async () => {
    const res = await post({ email, password: PASSWORD, remember: true });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('validation_failed');
  });

  it('chybějící pole vrací 422 s cestou v errors (kritérium 27)', async () => {
    const res = await post({ email });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors.map((e: { path: string }) => e.path)).toContain('password');
  });

  it('odpověď nese hlavičky RateLimit i při úspěchu (kritérium 32)', async () => {
    const res = await post({ email, password: PASSWORD });
    expect(res.headers.get('RateLimit-Limit')).toBeTruthy();
    expect(res.headers.get('RateLimit-Remaining')).toBeTruthy();
  });
});
