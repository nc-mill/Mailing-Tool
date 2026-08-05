import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';

/** Prostředí route souborů předvoleb odesílatele. Týž důvod jako u `ProvidersEnv`. */
export type SendersEnv = ApiEnv;

export const validationHook: Hook<unknown, SendersEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((p) => String(p)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const sendersApi = new OpenAPIHono<SendersEnv>({ defaultHook: validationHook });

/* Naplnění routeru běží při načtení modulu, viz komentář u domény providerů. */
import { registerSenderIdentityRoutes } from './senders.routes';

registerSenderIdentityRoutes(sendersApi);

export { registerSenderIdentityRoutes };

export function registerSenderIdentityApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', sendersApi);
}
