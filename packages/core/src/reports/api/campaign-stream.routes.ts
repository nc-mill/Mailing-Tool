import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { loadConfig } from '../../config/index';
import { ApiError } from '../../errors/api-error';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { readCampaignStats } from '../campaign-stats/read';
import { ConnectionLimiter } from '../stream/connections';
import { PollerRegistry, type StatsSnapshot } from '../stream/poller';
import { actorKey, inWorkspace, workspaceOf, type ReportsEnv } from './context';
import { uuidParam } from './schemas';

/** Kontrola změny po dvou sekundách, heartbeat po patnácti, strop spojení třicet minut. */
const CHECK_INTERVAL_MS = 2000;
const HEARTBEAT_MS = 15_000;
const MAX_CONNECTION_MS = 30 * 60 * 1000;

/**
 * ODCHYLKA OD PLÁNU: strop se čte líně, ne při načtení modulu. `loadConfig()`
 * v tomhle repozitáři validuje celé prostředí, takže volání na úrovni modulu
 * by shodilo import cest všude, kde prostředí není kompletní (generátor
 * OpenAPI, typová kontrola). Hodnota se přečte při prvním spojení a zůstane.
 */
let limiter: ConnectionLimiter | null = null;

export const streamLimiter = {
  get count(): number {
    return limiterInstance().count;
  },
  acquire(sessionKey: string) {
    return limiterInstance().acquire(sessionKey);
  },
};

function limiterInstance(): ConnectionLimiter {
  if (!limiter) {
    let maxTotal = 500;
    try {
      maxTotal = loadConfig().TRACKING_SSE_MAX_CONNECTIONS ?? 500;
    } catch {
      // Bez úplného prostředí platí výchozí hodnota z P01, ne pád.
    }
    limiter = new ConnectionLimiter({ maxTotal, maxPerSession: 2 });
  }
  return limiter;
}

/** Zapisovatel, který nezvýšil verzi, se musí projevit v logu, ne tichým zamrznutím reportu. */
let staleVersionCount = 0;
export function staleVersionTotal(): number {
  return staleVersionCount;
}

export const campaignStreamRoutes = new OpenAPIHono<ReportsEnv>();

const streamRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/stream',
  tags: ['reports'],
  summary: 'Živý průběh kampaně (SSE)',
  request: { params: uuidParam },
  responses: {
    200: { description: 'Proud událostí' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
    503: problemResponse('service_unavailable'),
  },
});

campaignStreamRoutes.openapi(streamRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ctx = workspaceOf(c);
  assertPermission(ctx, 'reports:read');
  // Klíč stropu se skládá z aktéra, ne z proměnné `sessionKey`: tu middleware
  // z P04 nenastavuje a `undefined` by sloučilo všechny uživatele projektu
  // do jednoho kbelíku, takže by druhý otevřený tab shodil kolegu.
  const sessionKey = `${ctx.workspaceId}:${actorKey(ctx.actor)}`;

  // Ověření přístupu proběhne dřív, než se otevře proud: chyba v těle SSE
  // by se ke klientovi dostala jako prázdný stream bez vysvětlení.
  const initial = await inWorkspace(c, (tx, workspace) => readCampaignStats(tx, workspace, id));

  const release = streamLimiter.acquire(sessionKey);
  if (!release) {
    // Vyčerpaný strop spojení se hlásí jako Problem Details, stejně jako každá
    // jiná chyba tohohle API. Dřív to byl obyčejný `application/json`
    // s `{ code: 'sse_capacity_reached' }`, tedy jediné místo v celém `/api/v1`,
    // které mluvilo jiným jazykem než RFC 9457. Klient na tom nestál: hledal
    // jsem, kdo ten kód čte, a nenašel nikoho, reaguje se na stav 503.
    //
    // Konkrétní důvod zůstává v `params.reason`, což je tvar zavedený jinde
    // v repu (viz `backups.routes.ts` a jeho `migrator_url_missing`).
    // `retryAfter` se propíše do hlavičky `Retry-After`.
    throw new ApiError('service_unavailable', {
      retryAfter: 5,
      params: { reason: 'sse_capacity_reached' },
    });
  }

  const registry = new PollerRegistry({
    intervalMs: CHECK_INTERVAL_MS,
    load: async (campaignId) =>
      inWorkspace(c, async (tx, workspace) => {
        const read = await readCampaignStats(tx, workspace, campaignId);
        return {
          version: read.version,
          updatedAt: read.updatedAt,
          counts: read.counts,
          status: read.status,
        } satisfies StatsSnapshot;
      }),
    onStaleVersion: () => {
      staleVersionCount += 1;
    },
  });

  // Bez tohohle nginx odpověď bufferuje a události chodí po dávkách.
  c.header('X-Accel-Buffering', 'no');

  const response = streamSSE(c, async (stream) => {
    const startedAt = Date.now();
    let closed = false;
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      release();
    };
    const queue: StatsSnapshot[] = [
      {
        version: initial.version,
        updatedAt: initial.updatedAt,
        counts: initial.counts,
        status: initial.status,
      },
    ];

    const unsubscribe = registry.subscribe(id, (snapshot) => queue.push(snapshot));
    stream.onAbort(() => {
      closed = true;
      unsubscribe();
      releaseOnce();
    });

    let lastHeartbeat = Date.now();

    try {
      while (!closed) {
        const snapshot = queue.shift();
        if (snapshot) {
          await stream.writeSSE({
            event: 'stats',
            id: String(snapshot.version),
            data: JSON.stringify({
              version: snapshot.version,
              status: snapshot.status,
              sent: snapshot.counts.sent,
              delivered: snapshot.counts.delivered,
              opens_unique: snapshot.counts.opensUnique,
              clicks_unique_human: snapshot.counts.clicksUniqueHuman,
            }),
          });
        }

        if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
          await stream.writeln(': heartbeat');
          lastHeartbeat = Date.now();
        }

        if (Date.now() - startedAt >= MAX_CONNECTION_MS) {
          await stream.writeSSE({ event: 'end', data: '{"reason":"max_duration"}' });
          break;
        }

        await stream.sleep(200);
      }
    } finally {
      unsubscribe();
      releaseOnce();
    }
  });

  /*
   * ODCHYLKA OD PLÁNU, VYNUCENÁ KNIHOVNOU. Plán nastavoval hlavičky přes
   * `c.header()` PŘED voláním `streamSSE`. Hono si ale uvnitř `streamSSE`
   * přepíše `Content-Type`, `Transfer-Encoding`, `Connection`
   * a hlavně `Cache-Control` na `no-cache`. Ověřeno testem: hlavička v odpovědi
   * skutečně byla `no-cache`, ne `no-store`. Rozdíl není kosmetický: `no-cache`
   * dovoluje mezilehlé vrstvě odpověď uložit a revalidovat, což u trvale
   * otevřeného proudu znamená zaseknutou odpověď. Hlavičky se proto opravují
   * na hotové odpovědi, kde už je poslední slovo naše.
   */
  response.headers.set('Cache-Control', 'no-store, no-transform');
  response.headers.set('X-Accel-Buffering', 'no');
  return response;
});
