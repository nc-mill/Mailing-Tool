import { Hono, type Context } from 'hono';
import type { IdentifyResponse } from '../ingest/consume-token';
import type { IngestRequestMeta, IngestResponse } from '../ingest/ingest-service';

/**
 * Veřejný povrch `/e/**`, viz plán P10 Task 27.
 *
 * `sendBeacon` posílá ŘETĚZEC, tedy `Content-Type: text/plain;charset=UTF-8`,
 * aby nevyvolal preflight. Server proto MUSÍ přijmout JSON i s tímhle typem
 * obsahu.
 *
 * `OPTIONS /e/*` a `POST /e/identify` potřebují CORS výjimku stejně jako
 * `/e/track`. Bez toho neprojde preflight u cross-origin JSON POST a `ml_token`
 * se nikdy nespotřebuje. Navenek by to vypadalo jako „identifikace prostě
 * nefunguje" bez jediné chyby na serveru, protože požadavek by se na server
 * vůbec nedostal.
 *
 * `/e/v1/batch` je TRVALÝ alias na `/e/track`. Kanonická cesta je `/e/track`,
 * ale alias existuje, protože zabundlované SDK na cizím webu žije roky.
 */

const MAX_BODY_BYTES = 64 * 1024;

/** CORS podle 3.7.5. `Allow-Credentials` se nenastavuje, s hvězdičkou je to neplatné. */
const CORS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

export type PublicEventDeps = {
  accept: (input: unknown, meta: IngestRequestMeta) => Promise<IngestResponse>;
  identify: (input: unknown, meta: IngestRequestMeta) => Promise<IdentifyResponse>;
  serveSdk: (request: Request) => Response;
  consumeRateLimit: (key: string, route: 'track' | 'identify') => Promise<boolean>;
  clientIp?: (headers: Record<string, string | undefined>) => string | null;
};

function problem(code: string, status: number, params?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      type: `https://docs.mlain.dev/errors/${code}`,
      title: code,
      status,
      code,
      ...(params === undefined ? {} : { params }),
    }),
    { status, headers: { ...CORS_HEADERS, 'content-type': 'application/problem+json' } },
  );
}

function rateLimited(): Response {
  return new Response(JSON.stringify({ code: 'rate_limited', status: 429, retry_after: 60 }), {
    status: 429,
    headers: { ...CORS_HEADERS, 'content-type': 'application/problem+json', 'Retry-After': '60' },
  });
}

function headerBag(c: Context): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createPublicEventRoutes(deps: PublicEventDeps): Hono {
  const app = new Hono();

  app.options('/*', () => new Response(null, { status: 204, headers: CORS_HEADERS }));

  const handleTrack = async (c: Context): Promise<Response> => {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return problem('payload_too_large', 413);

    const headers = headerBag(c);
    const ip = deps.clientIp?.(headers) ?? 'unknown';
    if (!(await deps.consumeRateLimit(ip, 'track'))) return rateLimited();

    let parsed: unknown;
    try {
      // sendBeacon posílá text/plain, aby nevyvolal preflight. Tělo je JSON tak jako tak.
      parsed = JSON.parse(raw);
    } catch {
      return problem('invalid_json', 400);
    }

    const result = await deps.accept(parsed, { origin: headers['origin'], ip });
    if (result.problem !== undefined) {
      return problem(result.problem.code, result.status, result.problem.params);
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  };

  app.post('/track', handleTrack);
  // Trvalý alias. Kanonická cesta je /e/track, ale zabundlované SDK žije roky.
  app.post('/v1/batch', handleTrack);

  app.post('/identify', async (c) => {
    const headers = headerBag(c);
    const ip = deps.clientIp?.(headers) ?? 'unknown';
    if (!(await deps.consumeRateLimit(ip, 'identify'))) return rateLimited();

    let parsed: unknown;
    try {
      parsed = JSON.parse(await c.req.text());
    } catch {
      return problem('invalid_json', 400);
    }

    const result = await deps.identify(parsed, { origin: headers['origin'], ip });
    if (result.problem !== undefined) return problem(result.problem.code, result.status);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  });

  app.get('/ml.js', (c) => deps.serveSdk(c.req.raw));

  return app;
}
