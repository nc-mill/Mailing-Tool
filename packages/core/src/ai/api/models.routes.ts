import { createRoute, z } from '@hono/zod-openapi';
import { problemResponse } from '../../identity/api/schemas';
import { curatedModels, defaultModelFor } from '../catalog';
import { getProvider, type providerIdSchema } from '../providers';

export const modelEntryResponse = z.object({
  id: z.string(),
  label: z.string(),
  source: z.enum(['curated', 'provider']),
});

export const listModelsRoute = createRoute({
  method: 'get',
  path: '/ai/models',
  tags: ['AI'],
  request: {
    query: z.object({ credential_id: z.string().uuid().optional() }),
  },
  responses: {
    200: {
      description: 'Seznam modelů',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(modelEntryResponse),
            default_model: z.string().nullable(),
            catalog_updated_at: z.string(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

export type ListModelsDeps = {
  fetchProviderModels: (credentialId: string) => Promise<string[]>;
};

/**
 * U providerů se seznamovým endpointem se vrací skutečný seznam, u ostatních
 * kurátorovaný. Když živý seznam selže, spadne se na kurátorovaný a uživatel
 * může identifikátor vždy zadat ručně; prázdná nabídka není slepá ulička.
 */
export async function handleListModels(
  params: { provider: z.infer<typeof providerIdSchema>; credentialId: string | null },
  deps: ListModelsDeps,
) {
  const descriptor = getProvider(params.provider);
  const curated = curatedModels(params.provider).map((model) => ({
    id: model.id,
    label: model.label,
    source: 'curated' as const,
  }));

  if (!descriptor.hasModelListEndpoint || params.credentialId === null) {
    return { data: curated, default_model: defaultModelFor(params.provider) };
  }

  try {
    const live = await deps.fetchProviderModels(params.credentialId);
    const merged = [
      ...live.map((id) => ({ id, label: id, source: 'provider' as const })),
      ...curated.filter((model) => !live.includes(model.id)),
    ];
    return { data: merged, default_model: defaultModelFor(params.provider) };
  } catch {
    return { data: curated, default_model: defaultModelFor(params.provider) };
  }
}
