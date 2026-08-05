import { createRoute, z } from '@hono/zod-openapi';
import { problemResponse } from '../../identity/api/schemas';

/**
 * Veřejný tvar běhu extrakce.
 *
 * OPRAVA PROTI DŘÍVĚJŠÍMU ZNĚNÍ: schéma tu slibovalo `input_url`,
 * `normalized_url`, `hop_summary`, `bytes_fetched`, `duration_ms`, `created_at`
 * a `finished_at`. Repozitář ale ven vydává `toPublicExtraction`, tedy pět
 * polí, a víc jich vydávat nesmí: kritérium 53 zakazuje pustit z domény značky
 * cokoliv, z čeho jde odvodit, kam se server dostal a kam ne. Dokumentovaný
 * a skutečný tvar se rozcházely; obrazovka
 * (`apps/web/src/features/brand/use-extraction-poll.ts`) čte ten druhý.
 * Schéma se proto srovnalo na skutečnost, ne naopak.
 */
export const extractionResponse = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'blocked']),
    error_code: z.string().nullable(),
    brand_profile_id: z.string().uuid().nullable(),
    /** Z výsledku projdou jen varování pro uživatele, nic technického. */
    result: z.object({ warnings: z.array(z.string()).optional() }).nullable(),
  })
  .openapi('BrandExtraction');

export const createExtractionRoute = createRoute({
  method: 'post',
  path: '/brand/extractions',
  tags: ['Brand'],
  summary: 'Stáhne barvy a logo z webu a založí z nich značku',
  security: [{ bearerAuth: ['templates:write'] }],
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
    400: problemResponse(
      'brand_invalid_url',
      'brand_scheme_not_allowed',
      'brand_credentials_in_url',
      'brand_port_not_allowed',
      'brand_host_not_allowed',
      'brand_blocked_address',
    ),
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('brand_extract_running'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
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
  summary: 'Stav a výsledek jednoho běhu extrakce',
  security: [{ bearerAuth: ['templates:read'] }],
  request: { params: z.object({ extraction_id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Stav a výsledek extrakce',
      content: { 'application/json': { schema: extractionResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});
