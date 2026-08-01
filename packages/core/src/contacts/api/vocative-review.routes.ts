import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { assertPermission } from '../../identity/permissions';
import { VOCATIVE_REVIEW_GROUP_SOFT_LIMIT, VOCATIVE_REVIEW_RATIO_SOFT_LIMIT } from '../constants';
import { countReviewTotals, listReviewGroups } from '../repo/vocative-review';
import { applyGroupAction } from '../vocative-review/actions';
import type { ContactsEnv } from './index';
import { Uuid, problemResponse } from './schemas';

const TAG = 'Vocative review';

const GroupSchema = z
  .object({
    name_key: z.string(),
    kind: z.enum(['first', 'last']),
    gender: z.enum(['female', 'male', 'unknown']),
    gender_source: z.string(),
    suggested_vocative: z.string().nullable(),
    contact_count: z.number().int(),
    sample_surnames: z.array(z.string()),
    sample_contact_id: Uuid,
    reasons: z.array(z.string()),
  })
  .openapi('VocativeReviewGroup');

const ListQuery = z.object({
  import_id: z.string().max(200).optional(),
  kind: z.enum(['first', 'last']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const listRoute = createRoute({
  method: 'get',
  path: '/vocative-review',
  tags: [TAG],
  summary: 'Skupiny ke kontrole oslovení',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { query: ListQuery },
  responses: {
    200: {
      description: 'Skupiny ke kontrole',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(GroupSchema),
            /**
             * Strop ruční práce. Nad sto skupin nebo desetinu kontaktů rozhraní
             * nabídne jako doporučenou volbu neutrální oslovení, protože
             * proklikávání stovek skupin není přijatelné.
             */
            soft_limit_exceeded: z.boolean(),
            total_groups: z.number().int(),
            total_contacts: z.number().int(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const countRoute = createRoute({
  method: 'get',
  path: '/vocative-review/count',
  tags: [TAG],
  summary: 'Počty pro odznak v navigaci',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { query: z.object({ import_id: z.string().max(200).optional() }) },
  responses: {
    200: {
      description: 'Počty',
      content: {
        'application/json': {
          schema: z.object({
            groups: z.number().int(),
            contacts: z.number().int(),
            ratio: z.number(),
            soft_limit_exceeded: z.boolean(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const confirmRoute = createRoute({
  method: 'post',
  path: '/vocative-review/confirm',
  tags: [TAG],
  summary: 'Operace nad skupinami fronty',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              groups: z
                .array(
                  z
                    .object({
                      name_key: z.string().min(1).max(200),
                      kind: z.enum(['first', 'last']).default('first'),
                      // 'defer' tu SCHVÁLNĚ NENÍ (rozhodnutí R15). Endpoint, který
                      // přijme akci, kterou neumí provést, je horší než chybějící akce.
                      action: z.enum(['confirm', 'set_vocative', 'set_gender', 'no_name']),
                      vocative: z.string().max(100).optional(),
                      gender: z.enum(['female', 'male', 'unknown']).optional(),
                      // Výchozí true: bez přepisů se fronta nikdy nevyprázdní.
                      save_override: z.boolean().default(true),
                    })
                    .strict(),
                )
                .min(1)
                .max(100),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Zpracováno',
      content: {
        'application/json': {
          schema: z.object({
            results: z.array(
              z.object({
                name_key: z.string(),
                mode: z.enum(['sync', 'queued']),
                affected: z.number().int(),
              }),
            ),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

export function registerVocativeReviewRoutes(app: OpenAPIHono<ContactsEnv>): void {
  // Statická cesta se registruje dřív než by ji mohl pohltit parametr.
  app.openapi(countRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const totals = await countReviewTotals(ctx, c.req.valid('query').import_id);
    return c.json(
      {
        ...totals,
        soft_limit_exceeded:
          totals.groups > VOCATIVE_REVIEW_GROUP_SOFT_LIMIT ||
          totals.ratio > VOCATIVE_REVIEW_RATIO_SOFT_LIMIT,
      },
      200,
    );
  });

  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const query = c.req.valid('query');
    const groups = await listReviewGroups(ctx, {
      importId: query.import_id,
      kind: query.kind,
      limit: query.limit,
    });
    const totals = await countReviewTotals(ctx, query.import_id);

    return c.json(
      {
        data: groups,
        soft_limit_exceeded:
          totals.groups > VOCATIVE_REVIEW_GROUP_SOFT_LIMIT ||
          totals.ratio > VOCATIVE_REVIEW_RATIO_SOFT_LIMIT,
        total_groups: totals.groups,
        total_contacts: totals.contacts,
      },
      200,
    );
  });

  app.openapi(confirmRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const results: { name_key: string; mode: 'sync' | 'queued'; affected: number }[] = [];
    for (const group of c.req.valid('json').groups) {
      const result = await applyGroupAction(ctx, {
        nameKey: group.name_key,
        kind: group.kind,
        action: group.action,
        vocative: group.vocative,
        gender: group.gender,
        saveOverride: group.save_override,
      });
      results.push({ name_key: group.name_key, ...result });
    }
    return c.json({ results }, 200);
  });
}
