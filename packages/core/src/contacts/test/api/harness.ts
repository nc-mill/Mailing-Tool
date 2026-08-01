import { OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../../errors/api-error';
import { buildProblem } from '../../../errors/problem';
import type { WorkspaceContext } from '../../../identity/types';
import { validationHook, type ContactsEnv } from '../../api/index';

/**
 * Testovací aplikace pro route soubory domény kontaktů.
 *
 * Zrcadlí to, co v produkci dělá `apps/web/src/lib/api/app.ts`: naplní proměnnou `auth`,
 * kterou tam plní autentizační middleware, a chybu převede na obálku RFC 9457. Bez toho
 * by testy měřily jen to, že Hono routuje, a ne to, co endpoint vrací.
 */
export function apiHarness(
  register: (app: OpenAPIHono<ContactsEnv>) => void,
  auth: { ctx?: Partial<WorkspaceContext> } = {},
): OpenAPIHono<ContactsEnv> {
  const app = new OpenAPIHono<ContactsEnv>({ defaultHook: validationHook });

  app.use('*', async (c, next) => {
    c.set('requestId', 'test-request');
    c.set('auth', {
      ctx: {
        workspaceId: '0198e2c0-0000-7000-8000-000000000001',
        actor: { type: 'user', userId: '0198e2c0-0000-7000-8000-000000000002', role: 'owner' },
        ...auth.ctx,
      } as WorkspaceContext,
      label: 'test@example.cz',
    });
    await next();
  });

  app.onError((err, c) => {
    const error = err instanceof ApiError ? err : new ApiError('internal_error', { cause: err });
    const body = buildProblem({
      code: error.code,
      instance: new URL(c.req.url).pathname,
      requestId: 'test-request',
      ...(error.errors === undefined ? {} : { errors: error.errors }),
      ...(error.params === undefined ? {} : { params: error.params }),
    });
    return new Response(JSON.stringify(body), {
      status: error.status,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  });

  register(app);
  return app;
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' };
