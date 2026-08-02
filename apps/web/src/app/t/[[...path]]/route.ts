import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { getTrackingRuntime } from '../tracking-runtime';

/**
 * Veřejný povrch `/t/**`: open pixel a přesměrování prokliku. Autentizuje se
 * výhradně podepsaným tokenem, session ani CSRF tady nejsou, protože požadavek
 * přichází z poštovního klienta.
 *
 * Runtime je Node.js, ne edge: potřebujeme node:crypto a pg.
 *
 * ODCHYLKA OD PLÁNU, dvě:
 *
 * 1. Import je relativní na `../tracking-runtime` místo `@/lib/tracking-runtime`.
 *    Modul v `lib/` dodává Task 24, viz komentář v samotném souboru.
 *
 * 2. Podaplikace se MOUNTUJE přes `new Hono().route('/t', …)`, ne přes
 *    `podaplikace.basePath('/t')`, jak psal plán. `basePath()` v Honu 4 vrací
 *    klon, který SDÍLÍ už naplněný router, a prefix se uplatní jen na cesty
 *    zaregistrované PO jeho zavolání. Cesty téhle podaplikace vznikly dřív,
 *    takže by v routeru zůstaly jako `/o/:token` a každý požadavek na
 *    `/t/o/<token>` by skončil Honovým 404. Ověřeno spuštěním proti běžící
 *    aplikaci na portu 3100: s `basePath` vracelo `/t/o/<platný token>`
 *    `404 Not Found` (13 B, text/plain), po přepnutí na `route()` vrací
 *    `200 image/gif` a 42 bajtů.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aplikace se skládá až při prvním požadavku. Kdyby vznikala na úrovni modulu,
 * sáhla by při importu na `getTrackingRuntime()`, ten na `loadConfig()`,
 * a `next build` by ve fázi „Collecting page data" spadl na chybějícím
 * `SECRET_KEY` a `DATABASE_URL`. Podrobně je to popsané v `tracking-runtime.ts`.
 *
 * `dynamic = 'force-dynamic'` výš tohle NEŘEŠÍ: říká, že se trasa nemá
 * předrenderovat, ne že se nemá naimportovat její modul.
 */
let handler: ReturnType<typeof handle> | undefined;

function getHandler(): ReturnType<typeof handle> {
  handler ??= handle(new Hono().route('/t', getTrackingRuntime().publicTrackingRoutes));
  return handler;
}

export const GET = (...args: Parameters<ReturnType<typeof handle>>): Response | Promise<Response> =>
  getHandler()(...args);
export const HEAD = (
  ...args: Parameters<ReturnType<typeof handle>>
): Response | Promise<Response> => getHandler()(...args);
