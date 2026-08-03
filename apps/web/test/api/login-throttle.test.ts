// @vitest-environment node
//
// Výchozí prostředí `apps/web` je jsdom. Pro databázové testy nejde použít,
// důvod je v komentáři `apps/web/test/api/pg-harness.ts`.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { LOGIN_MAX_FAILURES } from '@mlain/core/identity/login';
import { startPgHarness, type PgHarness } from './pg-harness';
import { createTestApp, type TestApp } from './helpers/app';

/**
 * Vývojářský vypínač brzd přihlašování, proměnná `LOGIN_THROTTLING_DISABLED`.
 *
 * Test měří CHOVÁNÍ celé cesty přes HTTP, ne jen konfiguraci. Obě fáze staví
 * aplikaci znovu, protože registr limiterů i konfigurace se v `apps/web`
 * memoizují: bez `resetModules` by druhá fáze běžela nad registrem první.
 *
 * Prostředí je `NODE_ENV=test`, takže vypínač projde křížovými kontrolami.
 * Že v produkci neprojde, ověřuje `packages/core/test/config/cross-checks.test.ts`.
 */
let harness: PgHarness;

const PASSWORD = 'dostatecne-dlouhe-heslo';
const WRONG = 'uplne-jine-heslo';

async function seedUser(email: string): Promise<void> {
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Petr',
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
}

type Attempt = { status: number; code: string; retryAfter: number | null };

/** Pošle přihlášení a vrátí jen to, co je pro brzdy podstatné. */
async function attempt(
  app: TestApp,
  input: { email: string; password: string; ip: string },
): Promise<Attempt> {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': input.ip,
    },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  const body = res.status === 200 ? { code: 'ok' } : ((await res.json()) as { code?: string });
  const retryAfter = res.headers.get('Retry-After');
  return {
    status: res.status,
    code: body.code ?? 'ok',
    retryAfter: retryAfter === null ? null : Number(retryAfter),
  };
}

/**
 * Postaví aplikaci s daným nastavením vypínače. Modulová cache se musí zahodit
 * celá: konfiguraci drží `lib/runtime.ts`, registr limiterů `lib/api/rate-limit.ts`
 * a rozhodnutí o brzdách `@mlain/core/identity/throttle`.
 */
/**
 * Zavírače poolů ze VŠECH instancí modulu `@mlain/core/tx`, které tenhle soubor
 * vyrobil.
 *
 * `vi.resetModules()` nezahazuje jen registry, ale celou modulovou cache, takže
 * každé následné `import('@mlain/core/tx')` je JINÁ instance s VLASTNÍMI
 * singletony poolů. Zavolat na konci `closePools()` naimportované nahoře tedy
 * zavře jen pooly první instance; ty pozdější přežijí, harness pod nimi zahodí
 * databázi a Postgres je ukončí chybou 57P01.
 *
 * Projevilo se to zákeřně: všech 166 souborů a 1297 testů PROŠLO, ale vitest
 * ohlásil běh jako neúspěšný kvůli šesti nezachyceným chybám při úklidu. Zelená
 * sada hlášená jako selhání je v CI horší než padající test, protože se hledá
 * chyba tam, kde žádná není.
 */
const poolClosers = new Set<() => Promise<void>>();

async function buildAppWith(disabled: boolean): Promise<TestApp> {
  vi.resetModules();
  if (disabled) process.env['LOGIN_THROTTLING_DISABLED'] = 'true';
  else delete process.env['LOGIN_THROTTLING_DISABLED'];
  const { registerAuthRoutes: register } = await import('@mlain/core/identity/api/auth.routes');
  const tx = await import('@mlain/core/tx');
  poolClosers.add(tx.closePools);
  return createTestApp(register);
}

beforeAll(async () => {
  harness = await startPgHarness();
  process.env['TRUST_PROXY'] = '1';
  // Dotkne se modulu s cestami, aby import v obou fázích ukazoval na tentýž tvar.
  void registerAuthRoutes;
}, 180_000);

afterAll(async () => {
  delete process.env['LOGIN_THROTTLING_DISABLED'];
  // Nejdřív VŠECHNY instance, teprve pak harness: v opačném pořadí by se
  // databáze zahodila pod živými spoji a padala by 57P01.
  await closePools();
  for (const close of poolClosers) await close();
  poolClosers.clear();
  await harness?.stop();
});

beforeEach(() => {
  delete process.env['LOGIN_THROTTLING_DISABLED'];
});

describe('brzdy přihlašování bez vypínače (výchozí stav)', () => {
  it('šestý pokus z téže adresy na týž e-mail dostane 429 a čeká se stovky sekund', async () => {
    const app = await buildAppWith(false);
    const email = `throttle-on-${Date.now()}@example.cz`;
    await seedUser(email);
    const ip = '10.30.1.1';

    const attempts: Attempt[] = [];
    for (let i = 0; i < 7; i += 1) {
      attempts.push(await attempt(app, { email, password: WRONG, ip }));
    }

    // Pravidlo login_ip_email: 5 bodů na 300 s.
    expect(attempts.slice(0, 5).map((a) => a.status)).toEqual([401, 401, 401, 401, 401]);
    expect(attempts.slice(0, 5).every((a) => a.code === 'invalid_credentials')).toBe(true);

    const blocked = attempts.slice(5);
    expect(blocked.map((a) => a.status)).toEqual([429, 429]);
    expect(blocked.every((a) => a.code === 'rate_limited')).toBe(true);
    // Tohle je ta prodleva, kvůli které vypínač vznikl: řádově minuty.
    expect(blocked[0]!.retryAfter).toBeGreaterThan(120);

    // A platí i pro správné heslo, limit se ptá dřív než ověření.
    const correct = await attempt(app, { email, password: PASSWORD, ip });
    expect(correct.status).toBe(429);
  }, 120_000);

  it('deset neúspěchů z různých adres zamkne účet na čtvrt hodiny', async () => {
    const app = await buildAppWith(false);
    const email = `lock-on-${Date.now()}@example.cz`;
    await seedUser(email);

    // Každý pokus z jiné adresy, aby limiter nezastínil zamykání v databázi.
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      await attempt(app, { email, password: WRONG, ip: `10.30.2.${i + 1}` });
    }

    const locked = await attempt(app, { email, password: PASSWORD, ip: '10.30.2.200' });
    expect(locked.status).toBe(423);
    expect(locked.code).toBe('account_locked');
    // LOGIN_LOCK_MINUTES je 15, tedy 900 sekund.
    expect(locked.retryAfter).toBeGreaterThan(800);
  }, 120_000);
});

describe('brzdy přihlašování s LOGIN_THROTTLING_DISABLED=true', () => {
  it('dvacet pokusů z jedné adresy na jeden e-mail a ani jeden 429', async () => {
    const app = await buildAppWith(true);
    const email = `throttle-off-${Date.now()}@example.cz`;
    await seedUser(email);
    const ip = '10.31.1.1';

    const attempts: Attempt[] = [];
    for (let i = 0; i < 20; i += 1) {
      attempts.push(await attempt(app, { email, password: WRONG, ip }));
    }

    expect(attempts.map((a) => a.status)).toEqual(Array.from({ length: 20 }, () => 401));
    expect(attempts.every((a) => a.code === 'invalid_credentials')).toBe(true);

    // Dvacet je dvojnásobek prahu zámku, účet přesto zamčený není.
    const ok = await attempt(app, { email, password: PASSWORD, ip });
    expect(ok.status).toBe(200);
  }, 180_000);

  it('účet zamčený z dřívějška jde odemknout správným heslem, ne čekáním', async () => {
    const email = `lock-off-${Date.now()}@example.cz`;
    await seedUser(email);

    // Nejdřív se zamkne se zapnutými brzdami, tedy skutečným provozem.
    const guarded = await buildAppWith(false);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      await attempt(guarded, { email, password: WRONG, ip: `10.31.2.${i + 1}` });
    }
    const locked = await attempt(guarded, { email, password: PASSWORD, ip: '10.31.2.200' });
    expect(locked.status).toBe(423);

    // Pak se vypínač zapne a týž účet se přihlásí, aniž by se na cokoliv čekalo.
    const relaxed = await buildAppWith(true);
    const ok = await attempt(relaxed, { email, password: PASSWORD, ip: '10.31.2.200' });
    expect(ok.status).toBe(200);
  }, 180_000);

  it('heslo se ověřuje dál, vypínač nikoho nepouští dovnitř', async () => {
    const app = await buildAppWith(true);
    const email = `password-still-checked-${Date.now()}@example.cz`;
    await seedUser(email);

    const wrong = await attempt(app, { email, password: WRONG, ip: '10.31.3.1' });
    expect(wrong.status).toBe(401);
    expect(wrong.code).toBe('invalid_credentials');

    const unknown = await attempt(app, {
      email: `neexistuje-${Date.now()}@example.cz`,
      password: PASSWORD,
      ip: '10.31.3.2',
    });
    expect(unknown.status).toBe(401);
    expect(unknown.code).toBe('invalid_credentials');
  }, 120_000);

  it('limity, které s přihlašováním nesouvisí, zůstávají v platnosti', async () => {
    process.env['LOGIN_THROTTLING_DISABLED'] = 'true';
    vi.resetModules();
    const { createLimiterRegistry } = await import('../../src/lib/api/rate-limit');
    // Registrace zavírače i tady: `rate-limit` si `@mlain/core/tx` tahá
    // nepřímo, a nová instance modulu znamená nové pooly, i když je tenhle
    // registr s pamětí sám nepoužije.
    poolClosers.add((await import('@mlain/core/tx')).closePools);
    const registry = createLimiterRegistry({ backend: 'memory', enabled: true });

    for (const vypnute of ['login_ip', 'login_ip_email', 'password_reset_ip', 'setup_ip']) {
      expect(registry.limiters.has(vypnute as never), `${vypnute} má být vypnuté`).toBe(false);
    }
    for (const platne of ['api_key_read', 'api_key_write', 'campaign_send', 'contacts_import']) {
      expect(registry.limiters.has(platne as never), `${platne} má platit dál`).toBe(true);
    }
  });
});
