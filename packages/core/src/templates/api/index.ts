import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';

/**
 * Prostředí route souborů domény šablon. Stejný důvod jako u kontaktů,
 * segmentů a kampaní: autentizační middleware P04 plní proměnnou `auth`
 * tvaru `{ ctx, label }`, takže vlastní typ prostředí by znamenal `undefined`
 * za běhu.
 */
export type TemplatesEnv = ApiEnv;

export const validationHook: Hook<unknown, TemplatesEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((part) => String(part)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const templatesApi = new OpenAPIHono<TemplatesEnv>({ defaultHook: validationHook });

/*
 * Naplnění routeru běží PŘI NAČTENÍ MODULU, ne až v `registerTemplateApiRoutes`.
 * Druhé volání `buildApp()` (generátor OpenAPI, testy) by jinak přidalo každou
 * cestu podruhé a dokument by měl všechno dvakrát. Import je až tady, pod
 * definicí routeru, protože route soubor si odsud bere jen TYP prostředí.
 */
import { registerTemplateRoutes } from './templates.routes';

registerTemplateRoutes(templatesApi);

export { registerTemplateRoutes };

/**
 * Mount do hlavní aplikace. Prefix `/api/v1` se přidává tady, protože route
 * soubory píšou cesty relativně (`/templates`), stejně jako ostatní domény.
 */
export function registerTemplateApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', templatesApi);
}
