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
 * Kompoziční kořen extrakce a obsluha fronty. Reexportují se, aby bylo z jednoho
 * místa vidět, že doména má i zápisovou půlku: bez `createBrandExtractDeps` má
 * `createBrandRuntime` nula volajících a extrakce by nešla ven vůbec.
 */
export { createBrandExtractDeps, createBrandSweepDeps } from './jobs/brand-extract-deps';
export { brandExtractHandler } from './jobs/brand-extract-handler';
export type { BrandExtractJobData } from './jobs/brand-extract-handler';

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

export {
  DEFAULT_PALETTE,
  DEFAULT_TYPOGRAPHY,
  findBrandProfile,
  findDefaultBrandProfile,
  insertBrandProfile,
  listBrandProfiles,
} from './repo/profiles.repo';
export type {
  BrandPalette,
  BrandProfileSummary,
  BrandTypography,
  NewBrandProfile,
} from './repo/profiles.repo';

export {
  countExtractionsInLastHour,
  failStaleExtractions,
  findExtraction,
  finishExtraction,
  listRecentExtractions,
  markRunning,
  toPublicExtraction,
} from './repo/extractions.repo';
export type {
  ExtractionRow,
  ExtractionStatus,
  FinishExtractionInput,
  PublicExtraction,
} from './repo/extractions.repo';
