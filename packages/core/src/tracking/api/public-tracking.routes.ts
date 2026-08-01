import { Hono } from 'hono';
import { PIXEL_GIF, PIXEL_HEADERS } from '../open/gif';
import type { OpenRequest } from '../open/handle-open';
import type { ClickRequest, ClickResponse } from '../click/handle-click';
import { EXPIRED_PATH, REDIRECT_HEADERS } from '../click/handle-click';

const MAX_TOKEN_LENGTH = 512;

export type PublicTrackingDeps = {
  handleOpen: (request: OpenRequest) => void;
  handleClick: (request: ClickRequest) => Promise<ClickResponse>;
  /** Vrátí false při překročení limitu. Nikdy z toho nesmí být 429, viz 3.7.4. */
  consumeRateLimit: (key: string, route: 'open' | 'click') => Promise<boolean>;
  clientIp?: (headers: Record<string, string | undefined>) => string | null;
  country?: (ip: string | null) => string | null;
};

function headerBag(request: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createPublicTrackingRoutes(deps: PublicTrackingDeps): Hono {
  const app = new Hono();

  app.get('/o/:token', async (c) => {
    const token = c.req.param('token');
    if (token.length > MAX_TOKEN_LENGTH) return c.notFound();

    const headers = headerBag(c.req.raw);
    const ip = deps.clientIp?.(headers) ?? null;

    // Limit se uplatní tak, že se událost nezapíše. Odpověď zůstává stejná.
    if (await deps.consumeRateLimit(ip ?? 'unknown', 'open')) {
      deps.handleOpen({
        token,
        userAgent: headers['user-agent'] ?? '',
        method: c.req.method,
        headers,
        ip,
        now: new Date(),
        country: deps.country?.(ip) ?? null,
      });
    }

    // Kopie do Uint8Array schválně: `Buffer` není v typu `BodyInit`, který
    // vidí `apps/web` s DOM knihovnou, a sdílet podkladový ArrayBuffer napříč
    // požadavky by znamenalo, že jeden odeslaný pixel drží druhý.
    return new Response(new Uint8Array(PIXEL_GIF), { status: 200, headers: PIXEL_HEADERS });
  });

  app.on(['GET', 'HEAD'], '/c/:token', async (c) => {
    const token = c.req.param('token');
    if (token.length > MAX_TOKEN_LENGTH) return c.notFound();

    const headers = headerBag(c.req.raw);
    const ip = deps.clientIp?.(headers) ?? null;
    const url = new URL(c.req.url);

    if (!(await deps.consumeRateLimit(ip ?? 'unknown', 'click'))) {
      // Bez zápisu, ale odkaz musí fungovat. Neplatnost cíle neznáme, takže expired.
      return new Response(null, {
        status: 302,
        headers: { ...REDIRECT_HEADERS, Location: EXPIRED_PATH },
      });
    }

    const result = await deps.handleClick({
      token,
      userAgent: headers['user-agent'] ?? '',
      method: c.req.method,
      headers,
      ip,
      query: url.search,
      now: new Date(),
    });

    return new Response(null, {
      status: result.status,
      headers: { ...result.headers, Location: result.location },
    });
  });

  return app;
}
