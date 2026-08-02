import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { WorkspaceContext } from '@mlain/db';
import { ApiError } from '@mlain/core/errors/api-error';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import { getConfig, getLogger } from '../runtime';
import { toProblem } from './problem';
import { resolveRequestId, REQUEST_ID_HEADER } from './request-id';
import { clientIpFrom } from './client-ip';

/** 4.1: tělo JSON nejvýš 1 MiB. Větší limity si endpoint deklaruje sám. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Cesty, které si deklarují vlastní Content-Type. V P04 žádná, doplňují domény. */
export const CONTENT_TYPE_EXEMPT_PREFIXES = new Set<string>();

/** Cesty kostry, které existují jen mimo produkci a autentizaci nepotřebují. */
const TEST_ROUTE_PREFIX = '/api/v1/__test';

/**
 * Typ prostředí bydlí v `packages/core`, protože ho potřebují definice cest
 * (`@mlain/core/identity/api/*.routes`) a `packages/core` nesmí importovat
 * z `apps/web` (graf závislostí v 3.11). Dvě definice téhož by se rozešly.
 */
export type { ApiVariables, ApiEnv } from '@mlain/core/identity/api/schemas';

/**
 * Diagnostické obohacení chyby `forbidden` o kolegy, které jde požádat o vyšší
 * roli (úkol 32). Registruje ho `authenticate.ts`, které vzniká až ve fázi E.
 *
 * ODCHYLKA OD PLÁNU: plán importoval `enrichForbidden` z `./authenticate.js`
 * napevno. Tady je z toho registrační bod, protože kostra aplikace musí být
 * přeložitelná a otestovatelná dřív, než `authenticate.ts` vůbec existuje,
 * a natvrdo psaný import na neexistující modul shodí typovou kontrolu celého
 * balíčku. Chování je stejné: dokud nikdo nic nezaregistruje, odejde původní
 * chyba beze změny.
 */
export type ForbiddenEnricher = (ctx: unknown, err: ApiError) => Promise<ApiError>;

let forbiddenEnricher: ForbiddenEnricher | null = null;

export function setForbiddenEnricher(enricher: ForbiddenEnricher | null): void {
  forbiddenEnricher = enricher;
}

/**
 * Logger API vrstvy. Je líný schválně: import modulu nesmí načítat konfiguraci,
 * protože pak by šlo `app.ts` naimportovat jen s kompletním prostředím.
 * Redakci citlivých cest má na starosti `createLogger` z `@mlain/core/logging`,
 * který jich zakrývá nadmnožinu oproti seznamu v plánu.
 */
export function apiLogger() {
  return getLogger();
}

export function problemResponseFor(c: Context<ApiEnv>, err: unknown): Response {
  const requestId = c.get('requestId') ?? resolveRequestId(c.req.header(REQUEST_ID_HEADER));
  const { body, status, headers } = toProblem(err, {
    path: new URL(c.req.url).pathname,
    requestId,
    acceptLanguage: c.req.header('Accept-Language') ?? null,
  });
  // Korelace musí být na odpovědi i tehdy, když se chybová odpověď skládá
  // mimo řetěz middleware. `c.header()` se do nově vyrobené Response nepropíše.
  headers[REQUEST_ID_HEADER] = requestId;
  // 4.2: interní detaily jdou do logu pod request_id, nikdy do odpovědi.
  if (status >= 500) {
    apiLogger().error(
      { request_id: body.request_id, route: body.instance, err },
      'unhandled_error',
    );
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function createApiApp() {
  const app = new OpenAPIHono<ApiEnv>({
    // 4.1: neznámý klíč a vadný tvar končí jako validation_failed, ne jako 400 od frameworku.
    defaultHook: (result) => {
      if (!result.success) {
        throw new ApiError('validation_failed', {
          errors: result.error.issues.map((issue) => ({
            path: (issue.path ?? []).map((p) => String(p)).join('.'),
            code: issue.code ?? 'invalid_value',
            message: issue.message,
          })),
        });
      }
    },
  });

  /**
   * Router jen ze SKUTEČNÝCH cest, bez middleware.
   *
   * ODCHYLKA OD PLÁNU: plán se ptal přímo `app.router.match(method, pathname)`.
   * Ověřeno spuštěním, že to na otázku „zná router tuhle cestu pod jinou
   * metodou" neodpovídá: `app.use('/api/v1/*', ...)` je v témže routeru
   * a matchne se na COKOLIV pod `/api/v1`, takže by každá neexistující cesta
   * dostala 405 místo 404. Sonda se proto plní z `app.routes` a vynechává
   * záznamy s metodou `ALL`, tedy právě middleware. Přestavuje se jen tehdy,
   * když cest přibude, a používá se výhradně na cestě k chybě 404.
   */
  let probe: Hono | null = null;
  let probedRoutes = -1;
  const routeProbe = (): Hono => {
    if (probe && probedRoutes === app.routes.length) return probe;
    const next = new Hono();
    for (const route of app.routes) {
      if (route.method === 'ALL') continue;
      next.on(route.method, route.path, () => new Response(null, { status: 204 }));
    }
    probe = next;
    probedRoutes = app.routes.length;
    return next;
  };

  /**
   * Zná router tuhle cestu pod PRÁVĚ POUŽITOU metodou? Když ano, request
   * obsloužil skutečný handler a případné `not_found` je doménová odpověď
   * („pro tebe ten zdroj neexistuje"), ne chybějící cesta.
   *
   * Bez téhle kontroly by se z každé doménové 404 stalo 405, jakmile cesta
   * existuje i pod jinou metodou. Naměřeno spuštěním: `GET /api/v1/api-keys`
   * s cizím projektem vracel 405, ačkoliv kritérium 19 žádá 404, a to je
   * chyba, která rovnou prozrazuje, že cesta existuje.
   */
  const knownUnderCurrentMethod = (c: Context<ApiEnv>): boolean => {
    const pathname = new URL(c.req.url).pathname;
    const [handlers] = routeProbe().router.match(c.req.method, pathname);
    return handlers !== undefined && handlers.length > 0;
  };

  /** Cesty, které router zná pod jinou metodou. Rozhoduje mezi 404 a 405. */
  const knownUnderAnotherMethod = (c: Context<ApiEnv>): boolean => {
    const pathname = new URL(c.req.url).pathname;
    const probed = routeProbe();
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
      if (method === c.req.method) continue;
      const [handlers] = probed.router.match(method, pathname);
      if (handlers && handlers.length > 0) return true;
    }
    return false;
  };

  // Korelace a základní kontext requestu.
  app.use('*', async (c, next) => {
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));
    c.set('requestId', requestId);
    c.set('startedAt', Date.now());
    c.set(
      'clientIp',
      clientIpFrom({
        xff: c.req.header('X-Forwarded-For'),
        remote: (c.env as { remoteAddress?: string } | undefined)?.remoteAddress ?? '127.0.0.1',
        trustProxy: getConfig().TRUST_PROXY,
      }),
    );
    c.header(REQUEST_ID_HEADER, requestId);
    await next();
    apiLogger().info(
      {
        request_id: requestId,
        route: new URL(c.req.url).pathname,
        status: c.res.status,
        duration_ms: Date.now() - c.get('startedAt'),
        workspace_id: c.get('workspaceId') ?? null,
        actor_type: c.get('actorType') ?? null,
        actor_id: c.get('actorId') ?? null,
      },
      'request',
    );
  });

  // 4.1: bez koncového lomítka. Request s ním dostane 308 na variantu bez něj.
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      return c.redirect(url.pathname.slice(0, -1) + url.search, 308);
    }
    await next();
  });

  // 4.1: metoda, kterou cesta nemá, je 405, ne 404. Rozlišení stojí na tom,
  // jestli router zná stejnou cestu pod jinou metodou.
  //
  // ODCHYLKA OD PLÁNU: plán se díval jen na `c.res.status` po `await next()`.
  // Ověřeno spuštěním, že to nestačí: `app.notFound()` z kostry chybu HODÍ,
  // a Hono výjimku z handleru propaguje skrz `next()` rovnou svému
  // `onError`, takže se kód za `await next()` nikdy neprovede. Bez větve
  // s `catch` by test na 405 dostal 404 a nikdo by nepoznal proč.
  app.use('/api/v1/*', async (c, next) => {
    try {
      await next();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'not_found' &&
        !knownUnderCurrentMethod(c) &&
        knownUnderAnotherMethod(c)
      ) {
        throw new ApiError('method_not_allowed');
      }
      throw err;
    }
    if (c.res.status === 404 && !knownUnderCurrentMethod(c) && knownUnderAnotherMethod(c)) {
      c.res = problemResponseFor(c, new ApiError('method_not_allowed'));
    }
  });

  // 4.1: limity requestu. Povolené Content-Type se určují per endpoint; tohle je
  // výchozí pravidlo pro /api/v1/**, endpoint s jiným typem si ho deklaruje sám
  // a zapíše prefix cesty do CONTENT_TYPE_EXEMPT_PREFIXES.
  app.use('/api/v1/*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'DELETE') {
      await next();
      return;
    }
    // Request BEZ TĚLA žádný Content-Type deklarovat nemá co. Týká se to zápisů,
    // které si vystačí s cestou a aktérem: POST /api/v1/auth/logout,
    // /auth/logout-all, rotace bez parametrů a `/ai/credentials/{id}/test`
    // i `/default`.
    //
    // ODCHYLKA OD PLÁNU, oprava vadné detekce. Undici (fetch v Node, kterým
    // `apiMutate` volá tohle API ze serverových akcí) u POST/PATCH bez těla
    // sám připojí `Content-Length: 0`, a Next.js pak `c.req.raw.body`
    // vykreslí jako neprázdný (prázdný) stream, ne jako `null`. Původní `||`
    // proto vyhodnotilo `hasBody = true` i pro request BEZ jediného bajtu,
    // klient neposlal `Content-Type` (nemá co deklarovat) a middleware to
    // shodil na 415, ačkoli šlo přesně o případ, který měl projít. Ověřeno
    // v prohlížeči: `POST /ai/credentials/{id}/test` i `/default` vracely
    // 415 „This Content-Type is not supported by this endpoint.“
    //
    // Oprava: když je `Content-Length` deklarovaná, je to jediná pravda o
    // tom, kolik bajtů request nese. `raw.body !== null` se použije jen bez
    // ní, pro chunked přenos bez délky předem.
    const declaredContentLength = c.req.header('Content-Length');
    const hasBody =
      declaredContentLength === undefined
        ? c.req.raw.body !== null
        : Number(declaredContentLength) > 0;
    const pathname = new URL(c.req.url).pathname;
    if (hasBody && ![...CONTENT_TYPE_EXEMPT_PREFIXES].some((p) => pathname.startsWith(p))) {
      const declared = c.req.header('Content-Type') ?? '';
      if (declared.split(';')[0]?.trim() !== 'application/json') {
        throw new ApiError('unsupported_media_type');
      }
    }
    const declaredLength = Number(declaredContentLength ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
      throw new ApiError('payload_too_large');
    }
    await next();
  });

  /**
   * Rozpoznání aktéra. Pořadí je podstatné: běží AŽ po kontrole Content-Type
   * a velikosti těla, aby se na vadném requestu zbytečně neověřoval klíč,
   * a PŘED registrací cest, aby handler měl `auth` k dispozici.
   *
   * Import je dynamický ze stejného důvodu jako u rate limitu níž a navíc tu
   * je jediné místo, kde se registruje obohacení chyby `forbidden`: kostra
   * aplikace ho drží jako registrační bod, ne jako natvrdo psaný import,
   * protože musí být přeložitelná i bez `authenticate.ts`.
   */
  let authMiddleware: MiddlewareHandler<ApiEnv> | null = null;
  app.use('/api/v1/*', async (c, next) => {
    const pathname = new URL(c.req.url).pathname;

    /**
     * Cesta, kterou router pod touhle metodou NEZNÁ, se neautentizuje.
     * Dva důvody, oba naměřené:
     *   - bez toho by neexistující cesta vracela 401 místo 404 a nepovolená
     *     metoda 401 místo 405, protože middleware běží před routováním;
     *   - `authenticate.ts` táhne `@mlain/db`, a ten se v prostředí jsdom
     *     ani naimportovat nedá (`fileURLToPath` na adrese http). Odložení
     *     importu za tuhle podmínku drží kostru testovatelnou tak, jak byla.
     */
    if (pathname.startsWith(TEST_ROUTE_PREFIX) || !knownUnderCurrentMethod(c)) {
      await next();
      return;
    }

    if (!authMiddleware) {
      const { authenticate, enrichForbidden } = await import('./authenticate');
      setForbiddenEnricher((ctx, err) => enrichForbidden(ctx as WorkspaceContext, err));
      authMiddleware = authenticate();
    }
    return authMiddleware(c, next);
  });

  // 4.5: dvě pravidla naráz. Samotná IP omezuje útočníka, dvojice IP a e-mail
  // omezuje útok na konkrétní účet zpoza mnoha adres.
  //
  // ODCHYLKA OD PLÁNU: `rate-limit.js` se importuje DYNAMICKY, uvnitř middleware.
  // Plán ho měl nahoře staticky, jenže katalog pravidel je v něm `const`, který
  // čte konfiguraci UŽ PŘI VYHODNOCENÍ MODULU. Statický import by tím udělal
  // z `app.ts` modul, který bez kompletního prostředí nejde ani naimportovat,
  // a shodil by `app.test.ts` i každý další test, který si prostředí nastavuje
  // až za importy. Dynamický import se vyhodnotí až při prvním requestu, tedy
  // v okamžiku, kdy konfigurace existuje, a modul se pak drží v cache.
  app.use('/api/v1/auth/login', async (c, next) => {
    const { consumeAll, limiterRegistry } = await import('./rate-limit');
    const ip = c.get('clientIp');
    let email = '';
    try {
      email = String(((await c.req.raw.clone().json()) as { email?: unknown }).email ?? '');
    } catch {
      email = '';
    }
    const headers = await consumeAll(limiterRegistry(), [
      { rule: 'login_ip', key: ip },
      { rule: 'login_ip_email', key: `${ip}|${email.toLowerCase()}` },
    ]);
    await next();
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
  });

  // 4.5: první spuštění instalace, deset pokusů z adresy za hodinu.
  app.use('/api/v1/setup', async (c, next) => {
    const { consumeAll, limiterRegistry } = await import('./rate-limit');
    const headers = await consumeAll(limiterRegistry(), [
      { rule: 'setup_ip', key: c.get('clientIp') },
    ]);
    await next();
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
  });

  app.use('/api/v1/auth/password-reset', async (c, next) => {
    const { consumeAll, limiterRegistry } = await import('./rate-limit');
    const headers = await consumeAll(limiterRegistry(), [
      { rule: 'password_reset_ip', key: c.get('clientIp') },
    ]);
    await next();
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
  });

  app.notFound(() => {
    throw new ApiError('not_found');
  });

  // Chyba `forbidden` se před odesláním obohatí o kolegy, které jde požádat
  // o vyšší roli, a to jen tehdy, když aktér smí členy vidět (úkol 32).
  // Kdyby obohacení samo selhalo, odešle se původní chyba: diagnostika nesmí
  // shodit odpověď, kterou vysvětluje.
  app.onError(async (err, c) => {
    const auth = (c.get as (key: string) => unknown)('auth') as { ctx?: unknown } | undefined;
    const ctx = auth?.ctx;
    if (ctx && forbiddenEnricher && err instanceof ApiError && err.code === 'forbidden') {
      try {
        return problemResponseFor(c as Context<ApiEnv>, await forbiddenEnricher(ctx, err));
      } catch {
        // spadneme na původní chybu níž
      }
    }
    return problemResponseFor(c as Context<ApiEnv>, err);
  });

  // Cesty, které existují jen mimo produkci a slouží k ověření kostry.
  if (getConfig().NODE_ENV !== 'production') {
    app.get('/api/v1/__test/ok', (c) => c.json({ ok: true }));
    app.post('/api/v1/__test/echo', async (c) => c.json(await c.req.json()));
    app.get('/api/v1/__test/boom', () => {
      throw new Error('select * from users where password_hash = $1');
    });
  }

  return app;
}
