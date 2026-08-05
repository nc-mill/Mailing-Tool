import { loadConfig } from '@mlain/core/config';
import {
  EventBuffer,
  LinkCache,
  ProxyRangeIndex,
  TrackingDomainCache,
  buildTrackingKeyring,
  createClickHandler,
  createOpenHandler,
  createPublicTrackingRoutes,
  currentTrackingKeyId,
  flushTrackingEvents,
  lookupMessage,
  type BufferedTrackingEvent,
  type TrackingKeyring,
} from '@mlain/core/tracking';

/**
 * ODCHYLKA OD PLÁNU, VĚDOMÁ A DOČASNÁ.
 *
 * Plán chce živé instance v `apps/web/src/lib/tracking-runtime.ts` a dodává je
 * Task 24, tedy mimo rozsah úkolů 1 až 21. Route handler by ale bez nich měl
 * viset na neexistujícím importu a `next build` i `tsc` by na něm spadly, takže
 * by celý web přestal jít přeložit kvůli souboru, který nikdo nevolá.
 *
 * Wiring je proto tady, vedle route handleru, a je složený VÝHRADNĚ z modulů,
 * které dodaly úkoly 1 až 21. Až Task 24 soubor v `lib/` založí, tenhle se
 * změní na jeden reexport a zmizí.
 *
 * Tři místa, která Task 24 doplní a která jsou tady schválně zjednodušená:
 *  - `consumeRateLimit` zatím nikoho neomezuje. Limity patří do
 *    `apps/web/src/lib/tracking-rate-limit.ts`, což je taky Task 24.
 *  - `isWebTrackingEnabled` nečte `workspaces.settings.tracking.web_tracking_enabled`.
 *    Kontrola registrované domény, tedy ta, která brání úniku identity na cizí
 *    web, platí i tak a je v `handle-click.ts`.
 *
 * Vyprazdňování bufferu už ODCHYLKA NENÍ. Funkce `flush` tady dřív žila jako
 * lokální kopie a zařazení navazujícího jobu `tracking.process_engagement`
 * v ní chybělo, takže se události zapsaly a nikdo z nich nespočítal statistiku.
 * Zápis i zařazení dělá `flushTrackingEvents` z `@mlain/core/tracking`,
 * tedy kód, který má vlastní databázový test.
 */

type BufferedEvent = BufferedTrackingEvent;

async function flush(batch: BufferedEvent[]): Promise<void> {
  await flushTrackingEvents(batch);
}

/**
 * Klientská IP z hlaviček reverzní proxy. Bere se PRVNÍ položka
 * `X-Forwarded-For`, protože další si může dopsat kdokoliv po cestě.
 */
function clientIp(headers: Record<string, string | undefined>): string | null {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded !== undefined && forwarded !== '') {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }
  return headers['x-real-ip'] ?? null;
}

export type TrackingRuntime = {
  readonly keyring: TrackingKeyring;
  readonly domains: TrackingDomainCache;
  readonly links: LinkCache;
  readonly buffer: EventBuffer<BufferedEvent>;
  readonly publicTrackingRoutes: ReturnType<typeof createPublicTrackingRoutes>;
};

/**
 * Runtime se skládá až při PRVNÍM požadavku, ne při načtení modulu.
 *
 * Původně to celé viselo na úrovni modulu a `next build` na tom padal:
 *
 * ```
 * Collecting page data using 9 workers ...
 * Error [ConfigError]: Konfigurace není platná, 3 problémů.
 *   { variable: 'APP_URL',      message: 'je povinná (required) a chybí' }
 *   { variable: 'SECRET_KEY',   message: 'je povinná (required) a chybí' }
 *   { variable: 'DATABASE_URL', message: 'je povinná (required) a chybí' }
 * Failed to collect page data for /t/[[...path]]
 * ```
 *
 * Fáze „Collecting page data" modul importuje, čímž vyhodnotila `loadConfig()`.
 * Produkční image by tedy nešla postavit bez znalosti `SECRET_KEY`
 * a `DATABASE_URL`. To je špatně z obou stran: v CI úloha `build-image` žádná
 * tajemství nedostává a padala by, a kdyby je někdo do stavby dodal, ZAPEKL BY
 * JE DO VRSTEV IMAGE. Image nesoucí podpisový klíč se nedá distribuovat, což je
 * horší než červená stavba. Konfigurace je běhová věc, ne sestavovací.
 *
 * `export const dynamic = 'force-dynamic'` v route handleru na tohle NESTAČÍ.
 * Řídí, jestli se trasa předrenderuje, ne jestli se její modul naimportuje.
 * V souboru bylo celou dobu a build padal stejně.
 *
 * Vedle konfigurace se na úrovni modulu spouštěl i časovač `domains.start()`,
 * takže si build sám pro sebe zakládal obnovovací smyčku nad databází, ke které
 * se nemá jak připojit.
 */
let cached: TrackingRuntime | undefined;

export function getTrackingRuntime(): TrackingRuntime {
  if (cached !== undefined) return cached;

  const config = loadConfig();

  // P01 rozkládá klíče už v konfiguraci a nechává si v `raw` původní zápis.
  // Ten se posílá dál, protože rozklad na keyring vlastní kontrakt a druhý
  // rozklad téhož řetězce by byl druhá implementace zmrazeného chování.
  const keyring: TrackingKeyring = buildTrackingKeyring({
    secretKey: config.SECRET_KEY.raw,
    secretKeyPrevious: config.SECRET_KEY_PREVIOUS.map((generation) => generation.raw).join(','),
  });

  const proxyRanges = new ProxyRangeIndex([], {
    useAppleRelayRanges: config.TRACKING_APPLE_RELAY_RANGES,
  });

  const domains = new TrackingDomainCache({ refreshMs: 60_000 });
  domains.start();

  const links = new LinkCache({ capacity: 5_000, ttlMs: 900_000 });

  const buffer = new EventBuffer<BufferedEvent>({
    flushMs: config.TRACKING_WRITER_FLUSH_MS,
    batchSize: config.TRACKING_WRITER_BATCH,
    capacity: config.TRACKING_WRITER_BATCH * 20,
    flush,
  });

  const handleOpen = createOpenHandler({
    keyring,
    proxyRanges,
    push: (item) => buffer.push(item),
  });

  const handleClick = createClickHandler({
    keyring,
    currentKeyId: currentTrackingKeyId(keyring),
    links,
    domains,
    push: (item) => buffer.push(item),
    lookupContactId: async (workspaceId, messageId, createdAt) => {
      const message = await lookupMessage({ workspaceId, messageId, messageCreatedAt: createdAt });
      return message?.contactId ?? null;
    },
    isWebTrackingEnabled: () => true,
    identityTokenTtlSeconds: config.TRACKING_IDENTITY_TOKEN_TTL_SECONDS,
    contactLookupTimeoutMs: 30,
  });

  cached = {
    keyring,
    domains,
    links,
    buffer,
    publicTrackingRoutes: createPublicTrackingRoutes({
      handleOpen,
      handleClick,
      consumeRateLimit: async () => true,
      clientIp,
    }),
  };
  return cached;
}
