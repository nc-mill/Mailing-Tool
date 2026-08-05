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
                input_cost_usd: z.number().nullable(),
                output_cost_usd: z.number().nullable(),
                /**
                 * SKUTEČNÁ částka, kterou poskytovatel naúčtoval. Je to jiná
                 * veličina než `estimated_cost_usd`, ne jeho přesnější verze,
                 * proto vedle něj a ne místo něj. `null` = poskytovatel ji
                 * nehlásí.
                 */
                reported_cost: z.number().nullable(),
                /**
                 * Jednotka částky výš, například `openrouter_credit`. NENÍ TO
                 * MĚNA: dokumentace OpenRouteru mluví o kreditech a nikde
                 * neuvádí, že kredit je dolar. Klient ji smí zobrazit, nesmí ji
                 * převádět.
                 */
                reported_cost_unit: z.string().nullable(),
                /** `null` = poskytovatel tokeny mezipaměti nehlásí, ne nula. */
                cache_read_tokens: z.number().nullable(),
                cache_write_tokens: z.number().nullable(),
                /**
                 * `reported` = skutečná částka od poskytovatele,
                 * `estimated` = odhad podle našeho ceníku,
                 * `provider_reports` = skutečnou částku vrací poskytovatel, ale
                 * u těchhle řádků žádná uložená není (data z doby před migrací
                 * 0012), `unknown` = cenu neznáme.
                 */
                price_status: z.enum(['reported', 'estimated', 'provider_reports', 'unknown']),
                long_context_threshold_tokens: z.number().nullable(),
              }),
            ),
            by_day: z.array(
              z.object({
                day: z.string(),
                requests: z.number(),
                input_tokens: z.number(),
                output_tokens: z.number(),
                errors: z.number(),
                estimated_cost_usd: z.number().nullable(),
                input_cost_usd: z.number().nullable(),
                output_cost_usd: z.number().nullable(),
                reported_cost: z.number().nullable(),
                reported_cost_unit: z.string().nullable(),
              }),
            ),
            estimated_cost_usd: z.number().nullable(),
            input_cost_usd: z.number().nullable(),
            output_cost_usd: z.number().nullable(),
            /**
             * Součet skutečně naúčtovaných částek. `null` také tehdy, když se
             * v období potkaly dvě různé jednotky: sečíst je by dalo číslo,
             * které neznamená nic.
             */
            reported_cost: z.number().nullable(),
            reported_cost_unit: z.string().nullable(),
            has_long_context_caveat: z.boolean(),
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
