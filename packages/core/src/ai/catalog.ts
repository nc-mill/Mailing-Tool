import { z } from 'zod';
import modelsRaw from './models.json' with { type: 'json' };
import pricingRaw from './pricing.json' with { type: 'json' };
import { PROVIDER_IDS, type ProviderId } from './providers';

const modelEntrySchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(120),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
});

const modelsSchema = z.object({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string(),
  providers: z.record(
    z.enum(PROVIDER_IDS),
    z.object({
      defaultModel: z.string().min(1).nullable(),
      models: z.array(modelEntrySchema),
    }),
  ),
});

const pricingSchema = z.object({
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.literal('USD'),
  note: z.string(),
  prices: z.record(
    z.string(),
    z.object({
      inputPerMTokUsd: z.number().nonnegative(),
      outputPerMTokUsd: z.number().nonnegative(),
    }),
  ),
});

const models = modelsSchema.parse(modelsRaw);
const pricing = pricingSchema.parse(pricingRaw);

export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type ModelPrice = { inputPerMTokUsd: number; outputPerMTokUsd: number };

export const CATALOG_UPDATED_AT = models.updatedAt;
export const PRICING_UPDATED_AT = pricing.updatedAt;

export function curatedModels(provider: ProviderId): readonly ModelEntry[] {
  return models.providers[provider]?.models ?? [];
}

export function defaultModelFor(provider: ProviderId): string | null {
  return models.providers[provider]?.defaultModel ?? null;
}

export function priceFor(provider: ProviderId, modelId: string): ModelPrice | null {
  return pricing.prices[`${provider}/${modelId}`] ?? null;
}

/**
 * Odhad ceny v dolarech. `null` znamená "model není v ceníku", což UI podá
 * jako spotřebu tokenů bez peněz. Nikdy nevrací nulu, protože nula by v UI
 * vypadala jako "zdarma".
 */
export function estimateCostUsd(
  provider: ProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = priceFor(provider, modelId);
  if (price === null) return null;
  const perToken = 1_000_000;
  return (
    (inputTokens / perToken) * price.inputPerMTokUsd +
    (outputTokens / perToken) * price.outputPerMTokUsd
  );
}
