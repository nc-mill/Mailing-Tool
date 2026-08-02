import { createRoute, z } from '@hono/zod-openapi';

const hopSchema = z.object({
  url: z.string(),
  status: z.number().int(),
  ipClass: z.literal('public'),
});

export const extractionResponse = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'blocked']),
  input_url: z.string(),
  normalized_url: z.string(),
  error_code: z.string().nullable(),
  hop_summary: z.array(hopSchema),
  bytes_fetched: z.number().int(),
  duration_ms: z.number().int().nullable(),
  result: z.unknown(),
  brand_profile_id: z.string().uuid().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

export const createExtractionRoute = createRoute({
  method: 'post',
  path: '/brand/extractions',
  tags: ['Brand'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            url: z.string().min(1).max(2048),
            infer_tone: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Extrakce zařazena, job běží na pozadí',
      content: { 'application/json': { schema: z.object({ id: z.string().uuid() }) } },
    },
    400: { description: 'Adresu nelze stahovat' },
    409: { description: 'Jiná extrakce už běží' },
    429: { description: 'Vyčerpaný hodinový limit' },
  },
});

/**
 * Průběh se nestreamuje přes SSE, ale zjišťuje se dotazem po 1000 ms
 * (rozhodnutí D4 plánu). Obrazovka potřebuje jen stav a uplynulý čas.
 */
export const getExtractionRoute = createRoute({
  method: 'get',
  path: '/brand/extractions/{extraction_id}',
  tags: ['Brand'],
  request: { params: z.object({ extraction_id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Stav a výsledek extrakce',
      content: { 'application/json': { schema: extractionResponse } },
    },
    404: { description: 'Extrakce neexistuje' },
  },
});
