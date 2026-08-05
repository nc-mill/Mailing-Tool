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
  /** Odkud se cena vzala a kdy jsme ji naposledy viděli na oficiální stránce. */
  sources: z.record(
    z.string(),
    z.object({
      url: z.string().url(),
      verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
  prices: z.record(
    z.string(),
    z.object({
      inputPerMTokUsd: z.number().nonnegative(),
      /**
       * Sazba za čtení z mezipaměti. Nepovinná: u části modelů ji poskytovatel
       * neuvádí a nula by znamenala „čtení z mezipaměti je zdarma", což není
       * pravda. Do výpočtu zatím nevstupuje, protože `ai_usage_daily` nedrží
       * tokeny z mezipaměti zvlášť; viz `estimateCostBreakdown`.
       */
      cachedInputPerMTokUsd: z.number().nonnegative().optional(),
      outputPerMTokUsd: z.number().nonnegative(),
      /**
       * Nad tímhle prahem účtuje poskytovatel víc než podle sazeb výš. Náš
       * odhad platí jen pod prahem a UI to musí u částky říct: tiše použít
       * nižší sazbu na dlouhý prompt je horší než cenu neuvést, protože
       * podhodnocené číslo vypadá věrohodně.
       */
      longContextThresholdTokens: z.number().int().positive().optional(),
      /** Do kdy sazba platí. Zaváděcí ceny mají konec, běžné ne. */
      validUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      note: z.string().optional(),
    }),
  ),
});

const models = modelsSchema.parse(modelsRaw);
const pricing = pricingSchema.parse(pricingRaw);

export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type ModelPrice = z.infer<typeof pricingSchema>['prices'][string];

export const CATALOG_UPDATED_AT = models.updatedAt;
export const PRICING_UPDATED_AT = pricing.updatedAt;
/** Odkazy na oficiální ceníky, ať jde v UI i v reportu doložit, odkud čísla jsou. */
export const PRICING_SOURCES = pricing.sources;

/**
 * Poskytovatelé, kteří vracejí SKUTEČNOU účtovanou částku přímo v odpovědi.
 * U nich se odhad z ceníku nepočítá schválně: jejich číslo je pravdivější než
 * náš součin tokenů a sazby, protože zahrnuje slevy za mezipaměť i výjimky
 * z ceníku (pole `overrides` v jejich `/api/v1/models`).
 *
 * Doloženo 3. 8. 2026 na https://openrouter.ai/docs/use-cases/usage-accounting:
 * pole `usage.cost` chodí v každé odpovědi bez parametru navíc.
 */
const PROVIDERS_REPORTING_COST: ReadonlySet<string> = new Set<ProviderId>(['openrouter']);

export function providerReportsCost(provider: ProviderId): boolean {
  return PROVIDERS_REPORTING_COST.has(provider);
}

/**
 * JEDNOTKA, ve které poskytovatel svoji částku posílá. NENÍ TO MĚNA a nesmí se
 * za měnu vydávat.
 *
 * Dokumentace OpenRouteru popisuje `usage.cost` doslova jako „Cost in credits"
 * (https://openrouter.ai/docs/use-cases/usage-accounting, ověřeno 3. 8. 2026).
 * U jiného endpointu tatáž dokumentace u pole `total_cost` píše „USD", takže
 * ta dvě místa si nejsou rovna, a NIKDE není napsáno, že jeden kredit je jeden
 * dolar. Dokud to doložené není, zůstává jednotka kreditem a UI ji tak
 * i pojmenuje. Kdo vztah doloží, přidá převod sem a doplní odkaz; kdo ho
 * nedoloží, ho nesmí předpokládat, protože dosazená měna vypadá stejně
 * důvěryhodně jako doložená.
 *
 * `null` znamená „tenhle poskytovatel žádnou částku nehlásí", takže se u něj
 * nemá co ukládat.
 */
const REPORTED_COST_UNITS: Readonly<Partial<Record<ProviderId, string>>> = {
  openrouter: 'openrouter_credit',
};

export function reportedCostUnitFor(provider: ProviderId): string | null {
  return REPORTED_COST_UNITS[provider] ?? null;
}

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
 * Rozpad odhadu na vstup a výstup. `null` znamená "model není v ceníku", což
 * UI podá jako spotřebu tokenů bez peněz. Nikdy nevrací nulu místo neznáma,
 * protože nula by v UI vypadala jako "zdarma".
 *
 * Sazba za čtení z mezipaměti se schválně nepoužívá: `ai_usage_daily` drží jen
 * `input_tokens` jako jedno číslo a nerozlišuje, kolik z nich přišlo
 * z mezipaměti. Dosadit levnější sazbu naslepo by odhad podstřelilo.
 */
export function estimateCostBreakdown(
  provider: ProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): { inputUsd: number; outputUsd: number; totalUsd: number } | null {
  const price = priceFor(provider, modelId);
  if (price === null) return null;
  const perToken = 1_000_000;
  const inputUsd = (inputTokens / perToken) * price.inputPerMTokUsd;
  const outputUsd = (outputTokens / perToken) * price.outputPerMTokUsd;
  return { inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
}

/**
 * Odhad ceny v dolarech. `null` znamená "model není v ceníku".
 */
export function estimateCostUsd(
  provider: ProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  return estimateCostBreakdown(provider, modelId, inputTokens, outputTokens)?.totalUsd ?? null;
}

/**
 * Práh, nad kterým poskytovatel účtuje víc, než umí náš odhad. `null` znamená
 * "jedna sazba na všechno". UI to musí u částky říct, jinak uživatel rozhoduje
 * o penězích podle čísla, které u dlouhých promptů může být poloviční.
 */
export function longContextThresholdFor(provider: ProviderId, modelId: string): number | null {
  return priceFor(provider, modelId)?.longContextThresholdTokens ?? null;
}
