import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../../errors/api-error';
import type { ApiEnv } from '../../../identity/api/schemas';

/** Stejný důvod jako u `ContactsEnv`: middleware P04 plní proměnnou `auth`. */
export type ImportsEnv = ApiEnv;

export const validationHook: Hook<unknown, ImportsEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((p) => String(p)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const importsApi = new OpenAPIHono<ImportsEnv>({ defaultHook: validationHook });

/*
 * Naplnění routeru běží při načtení modulu, aby druhé volání `buildApp()`
 * nepřidalo cesty podruhé. Pořadí je významné: `errors.csv` a `events` jsou
 * statické podsegmenty pod `{id}`, takže musí být registrované dřív než
 * obecnější tvary v témže souboru.
 */
import { registerImportRoutes } from './imports.routes';
import { registerImportEventRoutes } from './events.routes';

registerImportRoutes(importsApi);
registerImportEventRoutes(importsApi);

export { registerImportRoutes, registerImportEventRoutes };

export function registerImportApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', importsApi);
}
