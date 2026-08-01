import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import {
  estimateRetentionImpact,
  listRetentionPolicies,
  saveRetentionPolicies,
} from '../repo/retention';
import { RETENTION_TARGETS } from '../retention/registry';
import type { ContactsEnv } from './index';
import { IsoDateTime, problemResponse, toIso } from './schemas';

const TAG = 'Retention';

/** Nad tímhle podílem smazaných řádků se od uživatele žádá výslovné potvrzení. */
const LARGE_DELETION_RATIO = 0.1;

const PolicySchema = z
  .object({
    target: z.enum(RETENTION_TARGETS),
    retain_days: z.number().int().min(1).max(3650),
    action: z.enum(['delete', 'anonymize']),
    enabled: z.boolean(),
  })
  .strict()
  .openapi('RetentionPolicy');

const PolicyRowSchema = PolicySchema.extend({ last_run_at: IsoDateTime.nullable() });

/**
 * Politiku smí měnit jen vlastník projektu: špatně nastavená retence maže data,
 * která uživatel roky sbíral, a undo na to neexistuje.
 *
 * Klíč API vlastní roli nemá, takže sem nesmí vůbec: nevratné celoprojektové nastavení
 * se nemění integrací, ale člověkem.
 */
function assertOwner(ctx: WorkspaceContext): void {
  if (ctx.actor.type === 'system') return;
  if (ctx.actor.type !== 'user' || ctx.actor.role !== 'owner') {
    throw new ApiError('forbidden', {
      params: { detail: 'owner_only', requiredRole: 'owner' },
    });
  }
}

const getRoute = createRoute({
  method: 'get',
  path: '/retention-policies',
  tags: [TAG],
  summary: 'Politiky retence i s výchozími hodnotami',
  security: [{ bearerAuth: ['contacts:read'] }],
  responses: {
    200: {
      description: 'Politiky',
      content: { 'application/json': { schema: z.object({ data: z.array(PolicyRowSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const putRoute = createRoute({
  method: 'put',
  path: '/retention-policies',
  tags: [TAG],
  summary: 'Uložení politik retence, jen vlastník projektu',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              policies: z.array(PolicySchema).max(RETENTION_TARGETS.length),
              /** Potvrzení, když by první běh smazal víc než desetinu řádků. */
              confirm_large_deletion: z.boolean().default(false),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Uloženo',
      content: { 'application/json': { schema: z.object({ data: z.array(PolicyRowSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

export function registerRetentionRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(getRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const rows = await listRetentionPolicies(ctx);
    return c.json(
      { data: rows.map((row) => ({ ...row, last_run_at: toIso(row.last_run_at) })) },
      200,
    );
  });

  app.openapi(putRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertOwner(ctx);
    const body = c.req.valid('json');

    const impact = await estimateRetentionImpact(ctx, body.policies);
    if (impact.ratio > LARGE_DELETION_RATIO && !body.confirm_large_deletion) {
      // 409, ne 422: požadavek je platný, jen se nesmí provést bez potvrzení.
      // Počet dotčených řádků jde do params, aby ho obrazovka mohla ukázat ve větě.
      throw new ApiError('conflict', {
        params: {
          detail: 'retention_large_deletion',
          affected_rows: impact.rows,
          total_rows: impact.total,
          ratio: impact.ratio,
        },
      });
    }

    await saveRetentionPolicies(ctx, body.policies);
    const rows = await listRetentionPolicies(ctx);
    return c.json(
      { data: rows.map((row) => ({ ...row, last_run_at: toIso(row.last_run_at) })) },
      200,
    );
  });
}
