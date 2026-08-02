import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { RECIPIENT_FILTERS, readCampaignRecipients } from '../campaign-stats/recipients';
import { inWorkspace, workspaceOf, type ReportsEnv } from './context';
import { uuidParam } from './schemas';

export const campaignRecipientsRoutes = new OpenAPIHono<ReportsEnv>();

const recipientsRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/recipients',
  tags: ['reports'],
  summary: 'Příjemci kampaně a jejich engagement',
  request: {
    params: uuidParam,
    query: z.object({
      filter: z.enum(RECIPIENT_FILTERS).default('all'),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  },
  responses: {
    200: {
      description: 'Stránka příjemců',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(
              z.object({
                message_id: z.string(),
                contact_id: z.string().nullable(),
                email: z.string().nullable(),
                name: z.string().nullable(),
                contact_state: z.enum(['active', 'deleted', 'erased']),
                first_open_at: z.string().nullable(),
                first_click_at: z.string().nullable(),
                open_count: z.number(),
                click_count: z.number(),
                open_reliability: z.enum(['confirmed', 'machine']).nullable(),
              }),
            ),
            pagination: z.object({
              next_cursor: z.string().nullable(),
              prev_cursor: z.string().nullable(),
              has_more: z.boolean(),
              limit: z.number(),
            }),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

campaignRecipientsRoutes.openapi(recipientsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { filter, cursor, limit } = c.req.valid('query');
  assertPermission(workspaceOf(c), 'reports:read');
  const page = await inWorkspace(c, (tx, ctx) =>
    readCampaignRecipients(tx, ctx, {
      campaignId: id,
      filter,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );

  return c.json(
    {
      data: page.items.map((item) => ({
        message_id: item.messageId,
        contact_id: item.contactId,
        email: item.email,
        name: item.name,
        contact_state: item.contactState,
        first_open_at: item.firstOpenAt,
        first_click_at: item.firstClickAt,
        open_count: item.openCount,
        click_count: item.clickCount,
        open_reliability: item.openReliability,
      })),
      pagination: {
        next_cursor: page.nextCursor,
        prev_cursor: null,
        has_more: page.hasMore,
        limit,
      },
    },
    200,
  );
});
