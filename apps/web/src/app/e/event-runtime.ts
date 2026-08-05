import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { loadConfig } from '@mlain/core/config';
import { createSystemContext } from '@mlain/core/identity/context';
import {
  DEFAULT_TRACKING_SETTINGS,
  TtlLru,
  bindIdentity,
  buildTrackingKeyring,
  createIdentifyService,
  createIngestService,
  createPublicEventRoutes,
  createSdkResponder,
  enqueueEventBatch,
  originHost,
  originMatches,
  readAllowedOrigins,
  readTrackingSettings,
  resolvePublicKey,
  type AllowedOrigin,
  type TrackingKeyring,
  type TrackingSettings,
} from '@mlain/core/tracking';

/**
 * Běhový modul povrchu `/e/**`, tedy příjmu webových událostí.
 *
 * ODCHYLKA OD PLÁNU, TÁŽ JAKO U `/t/**`. Plán chce jeden společný
 * `apps/web/src/lib/tracking-runtime.ts` (Task 24). Ten soubor pořád
 * neexistuje a wiring `/t/**` žije vedle svého route handleru
 * v `app/t/tracking-runtime.ts` s vysvětlením proč. Tenhle soubor dělá totéž
 * pro `/e/**`. Až vznikne modul v `lib/`, oba se scvrknou na reexport.
 *
 * ODCHYLKA OD PLÁNU, DRUHÁ, a je to oprava vady zjištěné na datech: kontrola
 * `Origin` NEJDE přes `TrackingDomainCache`. Ta se plní dotazem napříč
 * projekty, který RLS na `tracking_domains` vrací prázdný, takže by `/e/track`
 * odmítalo i doménu, kterou má uživatel v seznamu. Podrobně je to popsané
 * u `readAllowedOrigins` v `packages/core/src/tracking/ingest/settings-service.ts`.
 * Domény se proto čtou pro jeden projekt, v jeho kontextu, s minutovou cache.
 *
 * Runtime je Node.js, ne edge: potřebujeme `node:fs`, `node:crypto` a `pg`.
 */

/**
 * Limity příjmu. Vlastní instance schválně, ne katalog z `lib/api/rate-limit.ts`:
 * ten je psaný pro cesty s relací a jeho `RuleName` vlastní jiná část. Přidat
 * do něj trackovací pravidla by znamenalo sáhnout do cizího souboru kvůli dvěma
 * řádkům. Backend je paměť, stejně jako u zbytku instalace ve výchozím stavu.
 */
type Limiters = { track: RateLimiterMemory; identify: RateLimiterMemory };

/** Nastavení projektu s minutovou cache. Čte se u každé přijaté dávky. */
const settingsCache = new TtlLru<string, TrackingSettings>({ capacity: 1_000, ttlMs: 60_000 });

/** Povolené domény projektu, taky s minutovou cache. */
const originsCache = new TtlLru<string, AllowedOrigin[]>({ capacity: 1_000, ttlMs: 60_000 });

function trackingSettings(workspaceId: string): TrackingSettings {
  return settingsCache.get(workspaceId) ?? DEFAULT_TRACKING_SETTINGS;
}

/**
 * Klientská IP z hlaviček reverzní proxy. Bere se PRVNÍ položka
 * `X-Forwarded-For`, stejně jako v `/t/**`, aby se obě cesty chovaly stejně.
 */
function clientIp(headers: Record<string, string | undefined>): string | null {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded !== undefined && forwarded !== '') {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }
  return headers['x-real-ip'] ?? null;
}

/**
 * Cesta k sestavenému SDK. V monorepu i v produkční image leží balíček vedle
 * aplikace, takže se hledá od kořene procesu. Chybějící soubor se NESMÍ
 * projevit jako pád trasy: vrátí se prázdný skript s komentářem, aby stránka
 * zákazníka nespadla na 500 a v konzoli bylo vidět proč.
 */
const SDK_CANDIDATES = [
  'packages/sdk-web/dist/ml.js',
  '../packages/sdk-web/dist/ml.js',
  '../../packages/sdk-web/dist/ml.js',
  '../../../packages/sdk-web/dist/ml.js',
];

function readSdkBundle(): string {
  for (const candidate of SDK_CANDIDATES) {
    try {
      return readFileSync(join(process.cwd(), candidate), 'utf8');
    } catch {
      // zkus další
    }
  }
  return '/* @mlain/sdk-web není sestavené: spusť `pnpm --filter @mlain/sdk-web run build` */\n';
}

export type EventRuntime = {
  readonly keyring: TrackingKeyring;
  readonly publicEventRoutes: ReturnType<typeof createPublicEventRoutes>;
};

let cached: EventRuntime | undefined;

/**
 * Runtime se skládá až při PRVNÍM požadavku, ne při načtení modulu. Kdyby
 * vznikal na úrovni modulu, sáhl by při importu na `loadConfig()` a `next build`
 * by ve fázi „Collecting page data" spadl na chybějícím `SECRET_KEY`
 * a `DATABASE_URL`. Podrobně je to popsané v `app/t/tracking-runtime.ts`.
 */
export function getEventRuntime(): EventRuntime {
  if (cached !== undefined) return cached;

  const config = loadConfig();

  const keyring: TrackingKeyring = buildTrackingKeyring({
    secretKey: config.SECRET_KEY.raw,
    secretKeyPrevious: config.SECRET_KEY_PREVIOUS.map((generation) => generation.raw).join(','),
  });

  const limiters: Limiters = {
    track: new RateLimiterMemory({
      keyPrefix: 'tracking:track',
      points: config.RATE_LIMIT_TRACK_KEY_IP,
      duration: 60,
    }),
    identify: new RateLimiterMemory({
      keyPrefix: 'tracking:identify',
      points: config.RATE_LIMIT_IDENTIFY_IP,
      duration: 60,
    }),
  };

  const consumeRateLimit = async (key: string, route: 'track' | 'identify'): Promise<boolean> => {
    if (!config.RATE_LIMIT_ENABLED) return true;
    try {
      await limiters[route].consume(key);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Ověření veřejného klíče zároveň nahřeje nastavení projektu a jeho domény.
   *
   * Bez toho by `allowServersidePublicKey`, `isWebTrackingEnabled`
   * a `isOriginAllowed` musely být `async` a služba by na ně čekala uprostřed
   * horké cesty. Klíč se ověřuje vždycky dřív než `Origin`, takže je to
   * jediné místo, kde se obojí dá načíst najednou.
   */
  const resolveAndWarm = async (key: string) => {
    const owner = await resolvePublicKey(key);
    if (owner === null) return null;

    const needsSettings = settingsCache.get(owner.workspaceId) === undefined;
    const needsOrigins = originsCache.get(owner.workspaceId) === undefined;
    if (needsSettings || needsOrigins) {
      /**
       * Kontext se vyrábí AŽ TADY, po ověření veřejného klíče. Projekt
       * pochází z řádku `api_keys`, nikdy z URL ani z těla požadavku, takže
       * je to táž situace jako u ověřené adresy v `trial-service.ts`: vnější
       * vstup je ověřený a teprve z něj vzniká `WorkspaceContext`. Čtecí
       * funkce proto berou kontext, ne řetězec, a cizí projekt jim nikdo
       * nepodstrčí.
       */
      const ctx = createSystemContext(owner.workspaceId, 'tracking.ingest');
      if (needsSettings) settingsCache.set(owner.workspaceId, await readTrackingSettings(ctx));
      if (needsOrigins) originsCache.set(owner.workspaceId, await readAllowedOrigins(ctx));
    }
    return owner;
  };

  const isOriginAllowed = (workspaceId: string, origin: string): boolean => {
    const host = originHost(origin);
    if (host === null) return false;
    return originMatches(originsCache.get(workspaceId) ?? [], host);
  };

  const ingestService = createIngestService({
    resolvePublicKey: resolveAndWarm,
    isOriginAllowed,
    allowServersidePublicKey: (workspaceId) =>
      trackingSettings(workspaceId).allow_serverside_public_key,
    isWebTrackingEnabled: (workspaceId) => trackingSettings(workspaceId).web_tracking_enabled,
    limits: {
      maxKeys: config.TRACKING_PROPERTIES_MAX_KEYS,
      maxDepth: config.TRACKING_PROPERTIES_MAX_DEPTH,
      maxString: config.TRACKING_PROPERTIES_MAX_STRING,
    },
    stripParams: config.TRACKING_STRIP_QUERY_PARAMS,
    enqueue: enqueueEventBatch,
    now: () => new Date(),
  });

  const identifyService = createIdentifyService({
    keyring,
    resolvePublicKey: resolveAndWarm,
    isOriginAllowed,
    bind: (input) => bindIdentity(input),
    now: () => new Date(),
  });

  const serveSdk = createSdkResponder({
    readBundle: readSdkBundle,
    version: config.IMAGE_VERSION,
  });

  cached = {
    keyring,
    publicEventRoutes: createPublicEventRoutes({
      accept: (input, meta) => ingestService.accept(input, meta),
      identify: (input, meta) => identifyService.identify(input, meta),
      serveSdk,
      consumeRateLimit,
      clientIp,
    }),
  };
  return cached;
}
