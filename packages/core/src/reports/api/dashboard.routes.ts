import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { TileCache } from '../dashboard/cache';
import { readDashboard, type DashboardPeriod } from '../dashboard/read';
import { inWorkspace, workspaceOf, type ReportsEnv } from './context';

export const dashboardRoutes = new OpenAPIHono<ReportsEnv>();

/** Jedna cache na proces. Klíč nese projekt i období, takže se data nemíchají. */
const cache = new TileCache();

const tileSchema = z.union([
  z.object({
    status: z.literal('ok'),
    data: z.record(z.string(), z.unknown()),
    computed_at: z.string(),
    stale: z.boolean(),
  }),
  z.object({ status: z.literal('error'), code: z.string() }),
]);

const dashboardRoute = createRoute({
  method: 'get',
  path: '/dashboard',
  tags: ['reports'],
  summary: 'Dlaždice přehledu',
  request: {
    query: z.object({
      period: z.coerce
        .number()
        .int()
        .refine((v) => [7, 30, 90].includes(v))
        .default(30),
    }),
  },
  responses: {
    200: {
      description: 'Dlaždice',
      content: {
        'application/json': {
          schema: z.object({
            period_days: z.number(),
            computed_at: z.string(),
            tiles: z.record(z.string(), tileSchema),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

dashboardRoutes.openapi(dashboardRoute, async (c) => {
  const { period } = c.req.valid('query');
  assertPermission(workspaceOf(c), 'reports:read');
  const result = await inWorkspace(c, async (tx, ctx) => {
    const { rows } = await tx.execute<{ timezone: string }>(
      sql`SELECT timezone FROM workspaces WHERE id = ${ctx.workspaceId}`,
    );
    return readDashboard(tx, ctx, {
      periodDays: period as DashboardPeriod,
      timezone: rows[0]?.timezone ?? 'UTC',
      cache,
    });
  });

  return c.json(
    {
      period_days: result.periodDays,
      computed_at: result.computedAt,
      tiles: Object.fromEntries(
        Object.entries(result.tiles).map(([key, tile]) => [
          key,
          tile.status === 'ok'
            ? {
                status: 'ok' as const,
                data: tile.data as Record<string, unknown>,
                computed_at: tile.computedAt,
                stale: tile.stale,
              }
            : tile,
        ]),
      ),
    },
    200,
  );
});
