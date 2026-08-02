/**
 * Veřejná plocha domény značky pro `apps/web` a `apps/worker`.
 *
 * Musí existovat, protože mapa `exports` v `packages/core/package.json` má pro
 * neuvedené domény jediný vzor, který hvězdičku nahradí jménem domény
 * a doplní `index.ts`.
 *
 * Reexportuje se odsud jen to, co má volající venku opravdu potřebovat.
 * Konektor, přenos a `safeFetch` tu schválně nejsou: ven z procesu se chodí
 * výhradně přes kompoziční kořen `runtime.ts`.
 */

export { BLOCKED_HOST_SUFFIXES, MAX_URL_LENGTH, normalizeBrandUrl } from './url';
export type { NormalizeResult, UrlPolicy } from './url';

export { createBrandRuntime } from './runtime';
export type { BrandRuntime, BrandRuntimeConfig } from './runtime';

export { assertTransition, publicExtraction, requestExtraction } from './brand-service';
export type {
  ExtractionHop,
  PublicExtractionView,
  RequestExtractionDeps,
  RequestExtractionLimits,
  RequestExtractionResult,
  ServiceExtractionRow,
} from './brand-service';

export { runBrandExtraction, sweepStaleExtractions } from './jobs/brand-extract';
export type { BrandExtractDeps } from './jobs/brand-extract';

/**
 * Analýza stažené stránky. Vrací se jen `analyzePage`, ne jednotlivé kroky:
 * volající venku nemá důvod skládat paletu z kandidátů sám.
 *
 * Typy `BrandPalette` a `BrandTypography` se odsud NEREEXPORTUJÍ. Stejná jména
 * už vydává `repo/profiles.repo` v tvaru, v jakém jsou uložené v databázi,
 * a dvě různé věci pod jedním jménem jsou horší než delší import.
 */
export { analyzePage } from './extract/analyze';
export type { BrandAnalysis, BrandAsset } from './extract/analyze';

export { inferTone, toneSchema } from './extract/tone';
export type { BrandTone } from './extract/tone';

export { findBrandProfile, findDefaultBrandProfile, listBrandProfiles } from './repo/profiles.repo';
export type { BrandPalette, BrandProfileSummary, BrandTypography } from './repo/profiles.repo';

export {
  countExtractionsInLastHour,
  findExtraction,
  listRecentExtractions,
  toPublicExtraction,
} from './repo/extractions.repo';
export type { ExtractionRow, ExtractionStatus, PublicExtraction } from './repo/extractions.repo';
