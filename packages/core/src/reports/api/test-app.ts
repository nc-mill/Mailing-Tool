import { OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import type { Tx, WorkspaceContext } from '../../tx';
import type { ReportsEnv } from './context';

/**
 * Testovací obal kolem cest domény.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM: plán stavěl v každém testu holé
 * `new OpenAPIHono()`. Takový router ale nemá ani `defaultHook`, ani `onError`,
 * takže vadné UUID by skončilo jako 400 od frameworku a `not_found` z domény
 * jako 500. Oboje mapuje v provozu kostra aplikace z P04
 * (`apps/web/src/lib/api/app.ts`), kterou `packages/core` importovat nesmí.
 * Tenhle soubor dělá totéž v malém, aby testy měřily chování cest, ne chybějící
 * middleware. Stavové kódy pocházejí z `ApiError.status`, tedy z registru P01.
 */
export function createTestApp(
  ctx: WorkspaceContext,
  tx: Tx,
  routers: Array<OpenAPIHono<never>>,
): OpenAPIHono<ReportsEnv> {
  const app = new OpenAPIHono<ReportsEnv>({
    defaultHook: (result) => {
      if (!result.success) throw new ApiError('validation_failed', { errors: [] });
    },
  });

  app.use('*', async (c, next) => {
    // Stejný tvar, jaký v provozu nastavuje middleware z P04.
    c.set('auth', { ctx, label: 'test' });
    c.set('reportsTx', tx);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ code: error.code, request_id: 'test' }, error.status as 400);
    }
    throw error;
  });

  for (const router of routers) app.route('/', router as unknown as OpenAPIHono<ReportsEnv>);
  return app;
}

/** Kontext uživatele, na kterém stojí strop spojení u živého proudu. */
export function userContext(workspaceId: string, userId: string): WorkspaceContext {
  return unsafeWorkspaceContext(workspaceId, { type: 'user', userId, role: 'owner' });
}
