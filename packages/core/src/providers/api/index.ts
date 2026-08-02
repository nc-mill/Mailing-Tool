import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';

/** Prostředí route souborů nastavení odesílání. Týž důvod jako u `CampaignsEnv`. */
export type ProvidersEnv = ApiEnv;

export const validationHook: Hook<unknown, ProvidersEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((p) => String(p)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const providersApi = new OpenAPIHono<ProvidersEnv>({ defaultHook: validationHook });

/* Naplnění routeru běží při načtení modulu, viz komentář u domény segmentů. */
import { registerProviderRoutes } from './providers.routes';

registerProviderRoutes(providersApi);

export { registerProviderRoutes };
export * from './service';
export * from './sns-webhook';

export function registerProviderApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', providersApi);
}
