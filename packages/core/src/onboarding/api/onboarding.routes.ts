import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { problemResponse, type ApiEnv } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { withWorkspace } from '../../tx';
import { dismissFinishedBanner, hideOnboardingPanel, loadOnboardingState } from '../state';
import { ONBOARDING_STEP_IDS } from '../types';

const TAG = 'Onboarding';

const StepSchema = z
  .object({
    id: z.enum(ONBOARDING_STEP_IDS),
    done: z.boolean(),
    href: z.string(),
    secondaryHref: z.string().nullable(),
  })
  .openapi('OnboardingStep');

const StateSchema = z
  .object({
    steps: z.array(StepSchema),
    doneCount: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    finished: z.boolean(),
    hidden: z.boolean(),
    finishedDismissed: z.boolean(),
  })
  .openapi('OnboardingState');

const HideBody = z
  .object({ hidden: z.boolean().optional(), dismissFinished: z.boolean().optional() })
  .strict()
  .openapi('OnboardingHideRequest');

const stateRoute = createRoute({
  method: 'get',
  path: '/api/v1/onboarding',
  tags: [TAG],
  summary: 'Stav průvodce prvním spuštěním pro aktuální projekt',
  security: [{ bearerAuth: ['timeline:read'] }],
  responses: {
    200: {
      description: 'Stav pěti kroků',
      content: { 'application/json': { schema: z.object({ data: StateSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const hideRoute = createRoute({
  method: 'post',
  path: '/api/v1/onboarding/hide',
  tags: [TAG],
  summary: 'Skryje nebo znovu zobrazí panel onboardingu',
  security: [{ bearerAuth: ['workspace:update'] }],
  request: { body: { content: { 'application/json': { schema: HideBody } } } },
  responses: {
    204: { description: 'Uloženo' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán psal endpointy jako soubory
 * `apps/web/src/app/api/v1/onboarding/route.ts` s pomocníkem `defineRoute`.
 * Veřejné API v tomhle repozitáři ale běží na Honu mountnutém do JEDNOHO
 * route handleru (`apps/web/src/app/api/v1/[[...route]]/route.ts`) a žádný
 * `defineRoute` neexistuje. Cesty proto žijí v `packages/core`, jako u všech
 * ostatních domén, a `apps/web/src/lib/api/openapi.ts` je jen mountuje;
 * graf závislostí opačný směr nedovoluje.
 *
 * Obálka `withWorkspace` je povinná: bez nastaveného `mlain.workspace_id`
 * by RLS odfiltrovala všechno a panel by v hotovém projektu ukazoval pět
 * neodškrtnutých kroků, bez jediné chyby.
 */
export function registerOnboardingRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(stateRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'timeline:read');
    const state = await withWorkspace(ctx, (tx) => loadOnboardingState(tx, ctx.workspaceId));
    if (state === null) throw new ApiError('not_found');
    return c.json({ data: state }, 200);
  });

  app.openapi(hideRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'workspace:update');
    const input = c.req.valid('json');
    // Obojí v JEDNÉ transakci. Dva zápisy do téhož jsonb sloupce ve dvou
    // transakcích by se navzájem přepsaly, protože jsonb_set čte celou hodnotu.
    await withWorkspace(ctx, async (tx) => {
      if (input.dismissFinished === true) await dismissFinishedBanner(tx, ctx.workspaceId);
      if (typeof input.hidden === 'boolean') {
        await hideOnboardingPanel(tx, ctx.workspaceId, input.hidden);
      }
    });
    return c.body(null, 204);
  });
}
