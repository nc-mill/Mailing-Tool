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

const app = buildApp();
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
