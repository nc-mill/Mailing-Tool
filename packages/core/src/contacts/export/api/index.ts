import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../../errors/api-error';
import type { ApiEnv } from '../../../identity/api/schemas';

export type ExportsEnv = ApiEnv;

export const validationHook: Hook<unknown, ExportsEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((p) => String(p)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const exportsApi = new OpenAPIHono<ExportsEnv>({ defaultHook: validationHook });

import { registerExportRoutes } from './exports.routes';

registerExportRoutes(exportsApi);

export { registerExportRoutes };

export function registerExportApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', exportsApi);
}
