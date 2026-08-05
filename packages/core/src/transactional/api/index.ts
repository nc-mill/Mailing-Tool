import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';

/**
 * Prostředí route souborů transakční pošty. Stejný důvod jako u kontaktů,
 * šablon a kampaní: autentizační middleware plní proměnnou `auth` tvaru
 * `{ ctx, label }`, takže vlastní typ prostředí by znamenal `undefined` za běhu.
 */
export type TransactionalEnv = ApiEnv;

export const validationHook: Hook<unknown, TransactionalEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((part) => String(part)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const transactionalApi = new OpenAPIHono<TransactionalEnv>({
  defaultHook: validationHook,
});

/*
 * Naplnění routeru běží PŘI NAČTENÍ MODULU, ne až v `registerTransactionalApiRoutes`.
 * Druhé volání `buildApp()` (generátor OpenAPI, testy) by jinak přidalo cestu
 * podruhé a dokument by ji měl dvakrát.
 */
import { registerTransactionalRoutes } from './transactional.routes';

registerTransactionalRoutes(transactionalApi);

export { registerTransactionalRoutes };

/** Mount do hlavní aplikace. Prefix `/api/v1` se přidává tady. */
export function registerTransactionalApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', transactionalApi);
}
