import { loadConfig, type MlainConfig } from '../config/index';

/**
 * Trackingové proměnné z jediného zod schématu části 1.
 * Tenhle modul nic nevaliduje a nic nedoplňuje, jen pojmenovává.
 * Validace i výchozí hodnoty jsou v packages/core/config, exit code 78 při chybě.
 *
 * ODCHYLKA OD PLÁNU: plán psal `import { config } from '@mlain/core/config'`.
 * P01 žádný takový singleton nevystavuje, jen `loadConfig()`, a je to správně:
 * modul, který si konfiguraci načte při importu, shodí každý jednotkový test,
 * který se ho jen dotkne. Konfigurace se proto čte líně a jednou, přesně jako
 * v `packages/core/src/tx/index.ts`.
 */
let configSingleton: MlainConfig | null = null;

function config(): MlainConfig {
  configSingleton ??= loadConfig();
  return configSingleton;
}

export type TrackingConfig = {
  identityTokenTtlSeconds: number;
  mergeWindowDays: number;
  mergeMaxEvents: number;
  retentionMonths: number;
  appleRelayRanges: boolean;
  allowIpStorage: boolean;
  storeCountry: boolean;
  geoipDbPath: string | undefined;
  stripQueryParams: readonly string[];
  piiPropertyKeys: readonly string[];
  writerFlushMs: number;
  writerBatch: number;
  allowServersidePublicKey: boolean;
  propertiesMaxKeys: number;
  propertiesMaxDepth: number;
  propertiesMaxString: number;
  importBatchMaxEvents: number;
  trackingDomain: string;
  appUrl: string;
};

/** Typovaný pohled na trackingové proměnné. Čte se až při zavolání. */
export function trackingConfig(): TrackingConfig {
  const c = config();
  return {
    identityTokenTtlSeconds: c.TRACKING_IDENTITY_TOKEN_TTL_SECONDS,
    mergeWindowDays: c.TRACKING_MERGE_WINDOW_DAYS,
    mergeMaxEvents: c.TRACKING_MERGE_MAX_EVENTS,
    retentionMonths: c.TRACKING_RETENTION_MONTHS,
    appleRelayRanges: c.TRACKING_APPLE_RELAY_RANGES,
    allowIpStorage: c.TRACKING_ALLOW_IP_STORAGE,
    storeCountry: c.TRACKING_STORE_COUNTRY,
    geoipDbPath: c.TRACKING_GEOIP_DB_PATH,
    stripQueryParams: c.TRACKING_STRIP_QUERY_PARAMS,
    piiPropertyKeys: c.TRACKING_PII_PROPERTY_KEYS,
    writerFlushMs: c.TRACKING_WRITER_FLUSH_MS,
    writerBatch: c.TRACKING_WRITER_BATCH,
    allowServersidePublicKey: c.TRACKING_ALLOW_SERVERSIDE_PUBLIC_KEY,
    propertiesMaxKeys: c.TRACKING_PROPERTIES_MAX_KEYS,
    propertiesMaxDepth: c.TRACKING_PROPERTIES_MAX_DEPTH,
    propertiesMaxString: c.TRACKING_PROPERTIES_MAX_STRING,
    importBatchMaxEvents: c.TRACKING_IMPORT_BATCH_MAX_EVENTS,
    trackingDomain: c.TRACKING_DOMAIN,
    appUrl: c.APP_URL,
  };
}

/**
 * Strop otevření jedné zprávy za den, viz 3.2.3. Není konfigurovatelný.
 *
 * Specifikace v 3.2.3 uvádí 100. Hodnota je tady 200 SCHVÁLNĚ: strop se počítá
 * odděleně pro každou třídu otevření (viz Task 14), takže tohle je celkový
 * součet a dílčí strop je jeho polovina. Kdyby se držela stovka na zprávu
 * celkem, Apple proxy by u aktivního čtenáře strop vyčerpala a skutečné lidské
 * otevření by se zahodilo.
 */
export const OPEN_CAP_PER_MESSAGE_PER_DAY = 200;

/** Deduplikační okno opakovaných stažení pixelu, viz 3.3.5. */
export const OPEN_DEDUP_WINDOW_SECONDS = 180;

/** Okno aplikační deduplikace web_events, odpovídá životnosti offline fronty SDK. */
export const WEB_EVENT_DEDUP_WINDOW_DAYS = 7;

/** Maximum domén na projekt, viz 3.7.3. */
export const TRACKING_DOMAIN_LIMIT = 20;
