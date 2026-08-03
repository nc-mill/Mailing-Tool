import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';

/**
 * Prostředí route souborů domény assetů. Stejný důvod jako u šablon: autentizační
 * middleware P04 plní proměnnou `auth` tvaru `{ ctx, label }`, takže vlastní typ
 * prostředí by znamenal `undefined` za běhu.
 */
export type AssetsEnv = ApiEnv;

export const validationHook: Hook<unknown, AssetsEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((part) => String(part)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const assetsApi = new OpenAPIHono<AssetsEnv>({ defaultHook: validationHook });

/*
 * Naplnění routeru běží PŘI NAČTENÍ MODULU, ne až v `registerAssetApiRoutes`.
 * Druhé volání `buildApp()` (generátor OpenAPI, testy) by jinak přidalo každou
 * cestu podruhé a dokument by měl všechno dvakrát. Import je až tady, pod
 * definicí routeru, protože route soubor si odsud bere jen TYP prostředí.
 */
import { registerAssetRoutes } from './assets.routes';

registerAssetRoutes(assetsApi);

export { registerAssetRoutes };

/** Mount do hlavní aplikace. Prefix `/api/v1` se přidává tady, jako u ostatních domén. */
export function registerAssetApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', assetsApi);
}
