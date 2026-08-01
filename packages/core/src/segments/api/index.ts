import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';

/**
 * Prostředí route souborů téhle domény. Stejný důvod jako u `ContactsEnv`:
 * autentizační middleware P04 plní proměnnou `auth` tvaru `{ ctx, label }`,
 * takže vlastní typ prostředí by znamenal `undefined` za běhu.
 */
export type SegmentsEnv = ApiEnv;

export const validationHook: Hook<unknown, SegmentsEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((p) => String(p)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const segmentsApi = new OpenAPIHono<SegmentsEnv>({ defaultHook: validationHook });

/*
 * Naplnění routeru běží PŘI NAČTENÍ MODULU, ne až v `registerSegmentRoutes`.
 * Druhé volání `buildApp()` (generátor OpenAPI, testy) by jinak přidalo každou
 * cestu podruhé a dokument by měl všechno dvakrát. Import je až tady, pod
 * definicí routeru, protože route soubor si odsud bere jen TYP prostředí.
 */
import { registerSegmentRoutes } from './segments.routes';

registerSegmentRoutes(segmentsApi);

export { registerSegmentRoutes };
export { segmentJsonSchema } from './json-schema';

/**
 * Mount do hlavní aplikace. Prefix `/api/v1` se přidává tady, protože route
 * soubory píšou cesty relativně (`/segments`), jak je má plán.
 */
export function registerSegmentApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', segmentsApi);
}
