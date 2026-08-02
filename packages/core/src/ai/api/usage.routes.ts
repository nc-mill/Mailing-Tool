import { createRoute, z } from '@hono/zod-openapi';
import { problemResponse } from '../../identity/api/schemas';

export const usageRoute = createRoute({
  method: 'get',
  path: '/ai/usage',
  tags: ['AI'],
  request: {
    query: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  },
  responses: {
    200: {
      description: 'Spotřeba za období',
      content: {
        'application/json': {
          schema: z.object({
            totals: z.object({
              requests: z.number(),
              input_tokens: z.number(),
              output_tokens: z.number(),
              errors: z.number(),
            }),
            by_model: z.array(
              z.object({
                provider: z.string(),
                model: z.string(),
                requests: z.number(),
                input_tokens: z.number(),
                output_tokens: z.number(),
                errors: z.number(),
                estimated_cost_usd: z.number().nullable(),
              }),
            ),
            by_day: z.array(
              z.object({
                day: z.string(),
                requests: z.number(),
                input_tokens: z.number(),
                output_tokens: z.number(),
                errors: z.number(),
              }),
            ),
            estimated_cost_usd: z.number().nullable(),
            pricing_updated_at: z.string(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});
