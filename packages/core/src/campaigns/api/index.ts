import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';

/**
 * Prostředí route souborů domény kampaní. Stejný důvod jako u `ContactsEnv`
 * a `SegmentsEnv`: autentizační middleware P04 plní proměnnou `auth` tvaru
 * `{ ctx, label }`, takže vlastní typ prostředí by znamenal `undefined` za běhu.
 */
export type CampaignsEnv = ApiEnv;

export const validationHook: Hook<unknown, CampaignsEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((p) => String(p)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const campaignsApi = new OpenAPIHono<CampaignsEnv>({ defaultHook: validationHook });

/*
 * Naplnění routeru běží PŘI NAČTENÍ MODULU, ne až v `registerCampaignApiRoutes`.
 * Druhé volání `buildApp()` (generátor OpenAPI, testy) by jinak přidalo každou
 * cestu podruhé a dokument by měl všechno dvakrát.
 */
import { registerCampaignRoutes } from './campaigns.routes';

registerCampaignRoutes(campaignsApi);

export { registerCampaignRoutes };
export * from './schemas';
export * from './audience-gates';
export * from './preflight-view';
export * from './service';

/**
 * Mount do hlavní aplikace. Prefix `/api/v1` se přidává tady, protože route
 * soubory píšou cesty relativně (`/campaigns`), jak je má plán.
 */
export function registerCampaignApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', campaignsApi);
}
