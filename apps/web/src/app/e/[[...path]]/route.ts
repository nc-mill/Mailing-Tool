import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { getEventRuntime } from '../event-runtime';

/**
 * Veřejný povrch `/e/**`: příjem webových událostí ze SDK, spotřebování
 * `ml_token` a servírování měřicího skriptu.
 *
 * Autentizuje se výhradně veřejným klíčem `ml_pub_` a hlavičkou `Origin`;
 * session ani CSRF tady nejsou, protože požadavek přichází z cizího webu.
 *
 * Runtime je Node.js, ne edge: potřebujeme `node:crypto`, `node:fs` a `pg`.
 *
 * Podaplikace se MOUNTUJE přes `new Hono().route('/e', …)`, ne přes
 * `podaplikace.basePath('/e')`, jak psal plán. `basePath()` v Honu 4 vrací
 * klon, který SDÍLÍ už naplněný router, a prefix se uplatní jen na cesty
 * zaregistrované PO jeho zavolání. Cesty téhle podaplikace vznikly dřív,
 * takže by v routeru zůstaly jako `/track` a každý požadavek na `/e/track`
 * by skončil Honovým 404. Je to tatáž past, na kterou narazil povrch `/t/**`,
 * a je popsaná v jeho route handleru.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aplikace se skládá až při prvním požadavku. Kdyby vznikala na úrovni modulu,
 * sáhla by při importu na `getEventRuntime()`, ten na `loadConfig()`,
 * a `next build` by ve fázi „Collecting page data" spadl na chybějícím
 * `SECRET_KEY` a `DATABASE_URL`.
 */
let handler: ReturnType<typeof handle> | undefined;

function getHandler(): ReturnType<typeof handle> {
  handler ??= handle(new Hono().route('/e', getEventRuntime().publicEventRoutes));
  return handler;
}

export const GET = (...args: Parameters<ReturnType<typeof handle>>): Response | Promise<Response> =>
  getHandler()(...args);
export const POST = (
  ...args: Parameters<ReturnType<typeof handle>>
): Response | Promise<Response> => getHandler()(...args);
export const OPTIONS = (
  ...args: Parameters<ReturnType<typeof handle>>
): Response | Promise<Response> => getHandler()(...args);
export const HEAD = (
  ...args: Parameters<ReturnType<typeof handle>>
): Response | Promise<Response> => getHandler()(...args);
