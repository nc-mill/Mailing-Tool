import { handle } from 'hono/vercel';
import { buildApp } from '../../../../lib/api/openapi';

/**
 * 4.1: veřejné REST API běží na Honu mountnutém do jednoho Next.js Route
 * Handleru. Jeden proces, sdílené typy, ale routing a validace mimo konvence
 * Next.js, protože potřebujeme generovat OpenAPI z definice cesty.
 *
 * Runtime je Node.js, ne edge: potřebujeme node:crypto, node:https a pg.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aplikace se skládá až při PRVNÍM požadavku, ne při načtení modulu.
 *
 * `buildApp()` registruje čtrnáct routerů a někde v té registraci se sáhne na
 * `loadConfig()`. Na úrovni modulu to znamenalo, že fáze „Collecting page data"
 * modul naimportuje a `next build` spadne:
 *
 * ```
 * Error [ConfigError]: Konfigurace není platná, 3 problémů.
 *   APP_URL, SECRET_KEY, DATABASE_URL: je povinná (required) a chybí
 * Failed to collect page data for /api/v1/[[...route]]
 * ```
 *
 * Produkční image by tedy nešla postavit bez znalosti podpisového klíče
 * a přístupu k databázi. Kdyby je někdo do stavby dodal, zapekl by je do
 * vrstev image. Konfigurace je běhová věc, ne sestavovací.
 *
 * `export const dynamic = 'force-dynamic'` výš na to NESTAČÍ a je tu celou
 * dobu: řídí, jestli se trasa předrenderuje, ne jestli se naimportuje její
 * modul. Import proběhne tak jako tak. Totéž řeší `app/t/tracking-runtime.ts`.
 */
let cached: ReturnType<typeof handle> | undefined;

function getHandler(): ReturnType<typeof handle> {
  cached ??= handle(buildApp());
  return cached;
}

const handler = (...args: Parameters<ReturnType<typeof handle>>): Response | Promise<Response> =>
  getHandler()(...args);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
