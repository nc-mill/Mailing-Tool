import { createRoute, z } from '@hono/zod-openapi';
import { problemResponse } from '../../identity/api/schemas';

const conversationSummary = z.object({
  id: z.string().uuid(),
  template_id: z.string().uuid().nullable(),
  title: z.string().nullable(),
  model: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const listConversationsRoute = createRoute({
  method: 'get',
  path: '/ai/conversations',
  tags: ['AI'],
  request: {
    query: z.object({
      template_id: z.string().uuid().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  },
  responses: {
    200: {
      description: 'Seznam konverzací',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(conversationSummary),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

export const getConversationRoute = createRoute({
  method: 'get',
  path: '/ai/conversations/{conversation_id}',
  tags: ['AI'],
  request: { params: z.object({ conversation_id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Konverzace včetně zpráv',
      content: {
        'application/json': {
          schema: conversationSummary.extend({
            messages: z.array(
              z.object({
                id: z.string().uuid(),
                seq: z.number().int(),
                role: z.enum(['system', 'user', 'assistant', 'tool']),
                parts: z.unknown(),
                input_tokens: z.number().nullable(),
                output_tokens: z.number().nullable(),
                finish_reason: z.string().nullable(),
                error_code: z.string().nullable(),
                created_at: z.string(),
              }),
            ),
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

export const deleteConversationRoute = createRoute({
  method: 'delete',
  path: '/ai/conversations/{conversation_id}',
  tags: ['AI'],
  request: { params: z.object({ conversation_id: z.string().uuid() }) },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});
