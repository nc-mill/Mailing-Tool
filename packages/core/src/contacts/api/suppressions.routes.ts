import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import { maskEmail } from '../email';
import {
  addSuppression,
  getSuppression,
  listSuppressionsPage,
  removeSuppression,
  type SuppressionRecord,
} from '../repo/suppressions';
import { SUPPRESSION_REASONS, type SuppressionReason } from '../suppression/rank';
import { canRemove, minimumAgeDays, type Role } from '../suppression/removal';
import type { ContactsEnv } from './index';
import {
  EmailInput,
  IdParam,
  IsoDateTime,
  Uuid,
  cursorQuery,
  paginated,
  problemResponse,
  toIsoRequired,
} from './schemas';

const TAG = 'Suppressions';

const SuppressionSchema = z
  .object({
    id: Uuid,
    /**
     * Adresa se vrací MASKOVANÁ. Je to seznam lidí, kteří si komunikaci nepřáli,
     * takže není důvod ho mít na obrazovce celý.
     */
    masked_email: z.string(),
    reason: z.enum(SUPPRESSION_REASONS),
    source: z.string(),
    removable: z.boolean(),
    /** Kolik dní zbývá, než půjde odebrat. null znamená, že to nepůjde nikdy. */
    removable_in_days: z.number().int().nullable(),
    detail: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    created_at: IsoDateTime,
  })
  .openapi('Suppression');

const SuppressionPageSchema = paginated(SuppressionSchema, 'SuppressionPage');

/**
 * Role aktéra pro matici odebrání. Klíč API vlastní role nemá, takže se odvozuje
 * z jeho scopes: kdo smí zapisovat do suppression listu, má stejnou pravomoc jako admin.
 * Systémový aktér je vlastník, protože běží jménem provozovatele.
 */
function roleOf(ctx: WorkspaceContext): Role {
  if (ctx.actor.type === 'user') return ctx.actor.role;
  if (ctx.actor.type === 'system') return 'owner';
  return ctx.actor.scopes.includes('suppressions:write') ? 'admin' : 'viewer';
}

function ageDaysOf(row: SuppressionRecord): number {
  const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return Math.floor((Date.now() - created.getTime()) / 86_400_000);
}

/**
 * Kolik dní zbývá do odebratelnosti. `null` znamená NIKDY, ne "hned":
 * stížnost, výmaz podle GDPR, odhlášení i blokace od providera se neodebírají vůbec,
 * a `minimumAgeDays` u nich vrací 0, takže samotný počet dní by tvrdil opak.
 */
function removableInDays(row: SuppressionRecord): number | null {
  const eventually = canRemove(row.reason, 'owner', Number.MAX_SAFE_INTEGER);
  if (!eventually.allowed) return null;
  return Math.max(0, minimumAgeDays(row.reason) - ageDaysOf(row));
}

function present(row: SuppressionRecord): z.infer<typeof SuppressionSchema> {
  return {
    id: row.id,
    masked_email: maskEmail(row.email),
    reason: row.reason,
    source: row.source,
    removable: row.removable,
    removable_in_days: removableInDays(row),
    detail: row.detail,
    metadata: row.metadata,
    created_at: toIsoRequired(row.created_at),
  };
}

const listRoute = createRoute({
  method: 'get',
  path: '/suppressions',
  tags: [TAG],
  summary: 'Blokované adresy, vždy maskované',
  security: [{ bearerAuth: ['suppressions:read'] }],
  request: {
    query: cursorQuery(['created_at.desc'], 'created_at.desc').extend({
      reason: z.enum(SUPPRESSION_REASONS).optional(),
      q: z.string().max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Blokované adresy',
      content: { 'application/json': { schema: SuppressionPageSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const addRoute = createRoute({
  method: 'post',
  path: '/suppressions',
  tags: [TAG],
  summary: 'Ruční zablokování adresy',
  security: [{ bearerAuth: ['suppressions:write'] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              email: EmailInput,
              reason: z.enum(SUPPRESSION_REASONS).default('manual'),
              detail: z.string().max(500).nullable().optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Zablokováno',
      content: {
        'application/json': { schema: z.object({ id: Uuid, created: z.boolean() }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const removeRoute = createRoute({
  method: 'delete',
  path: '/suppressions/{id}',
  tags: [TAG],
  summary: 'Odebrání blokace, jen podle matice a s poznámkou',
  security: [{ bearerAuth: ['suppressions:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': {
          // Poznámka je povinná: odebrání blokace se musí dát vysvětlit zpětně.
          schema: z.object({ note: z.string().min(1).max(500) }).strict(),
        },
      },
    },
  },
  responses: {
    204: { description: 'Odebráno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

export function registerSuppressionRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'suppressions:read');
    const query = c.req.valid('query');
    const page = await listSuppressionsPage(ctx, query);
    return c.json(
      {
        data: page.rows.map(present),
        pagination: {
          next_cursor: page.nextCursor,
          prev_cursor: null,
          has_more: page.hasMore,
          limit: query.limit,
        },
      },
      200,
    );
  });

  app.openapi(addRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'suppressions:write');
    const body = c.req.valid('json');
    const result = await addSuppression(ctx, {
      email: body.email,
      reason: body.reason as SuppressionReason,
      source: 'api',
      detail: body.detail ?? null,
    });
    return c.json({ id: result.suppressionId, created: result.created }, 201);
  });

  app.openapi(removeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'suppressions:write');
    const { id } = c.req.valid('param');
    const suppression = await getSuppression(ctx, id);
    if (suppression === null) throw new ApiError('not_found');

    const ageDays = ageDaysOf(suppression);
    const check = canRemove(suppression.reason, roleOf(ctx), ageDays);

    if (!check.allowed) {
      // Dva různé důvody a dva různé stavy: "tohle nesundáš nikdy" je 403,
      // "ještě ne" je 409 a nese počet zbývajících dní, aby uživatel věděl, kdy zkusit znovu.
      if (check.code === 'suppression_too_recent') {
        throw new ApiError('conflict', {
          params: {
            detail: 'suppression_too_recent',
            days_remaining: removableInDays(suppression),
          },
        });
      }
      throw new ApiError('forbidden', { params: { detail: check.code } });
    }

    await removeSuppression(ctx, id, c.req.valid('json'));
    return c.body(null, 204);
  });
}
