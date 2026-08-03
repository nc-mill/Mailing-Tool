import {
  RateLimiterMemory,
  RateLimiterPostgres,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible';
import pg from 'pg';
import { ApiError } from '@mlain/core/errors/api-error';
import {
  LOGIN_THROTTLE_RULE_NAMES,
  loginThrottlingDisabled,
  warnIfLoginThrottlingDisabled,
} from '@mlain/core/identity/throttle';
import { getConfig, getLogger } from '../runtime';

export type RuleName =
  | 'login_ip'
  | 'login_ip_email'
  | 'password_reset_ip'
  | 'setup_ip'
  | 'session_user'
  | 'api_key_read'
  | 'api_key_write'
  | 'contacts_import'
  | 'campaign_send';

export type Rule = { points: number; durationSec: number; configurable: boolean };

/**
 * Tabulka 4.5. Čísla u konfigurovatelných pravidel jsou VÝCHOZÍ hodnoty a berou
 * se z konfigurace; u nekonfigurovatelných jsou pevná, protože jde o bezpečnostní
 * opatření, kde je možnost hodnotu zvednout spíš díra než funkce.
 *
 * Limity trackovacích endpointů (RATE_LIMIT_TRACK_*) tady schválně nejsou:
 * patří části 5 a jejich pravidla si zaregistruje P10 do vlastního katalogu.
 *
 * KATALOG JE FUNKCE, NE KONSTANTA, a je to oprava vady, která se projevovala
 * jinde, než byla.
 *
 * Dřív to byl `export const` s literálem objektu, uvnitř kterého se volalo
 * `getConfig()`. Tím se konfigurace vyhodnotila při každém načtení modulu.
 * Tenhle soubor importuje `authenticate.ts` a ten importuje kdekdo, takže
 * `next build` padal ve fázi „Collecting page data" pokaždé, jen na jiné trase:
 *
 *   Failed to collect page data for /t/[[...path]]
 *   Failed to collect page data for /api/v1/[[...route]]
 *   Failed to collect page data for /api/internal/ai/chat
 *
 * Každá z těch tří se dala složit líně a stavba pak spadla na další. Byla to
 * hra na krtky: příčina nebyla v trasách, ale tady.
 *
 * Produkční image tedy nešla postavit bez znalosti `SECRET_KEY`
 * a `DATABASE_URL`. Kdyby je někdo do stavby dodal, zapekl by je do vrstev.
 * Konfigurace je běhová věc, ne sestavovací.
 *
 * `getConfig()` v `lib/runtime.ts` je napsané správně a memoizuje. Vada nebyla
 * v něm, ale v tom, KDY se poprvé zavolá.
 *
 * Volání `getConfig()` uvnitř funkcí níž v tomhle souboru jsou v pořádku
 * a nechávají se být.
 */
let cachedRules: Record<RuleName, Rule> | undefined;

export function rateLimitRules(): Record<RuleName, Rule> {
  cachedRules ??= {
    api_key_read: { points: getConfig().RATE_LIMIT_API_READ, durationSec: 60, configurable: true },
    api_key_write: {
      points: getConfig().RATE_LIMIT_API_WRITE,
      durationSec: 60,
      configurable: true,
    },
    campaign_send: { points: 30, durationSec: 3600, configurable: false },
    contacts_import: { points: 10, durationSec: 3600, configurable: false },
    login_ip: { points: 20, durationSec: 300, configurable: false },
    login_ip_email: { points: 5, durationSec: 300, configurable: false },
    password_reset_ip: { points: 5, durationSec: 3600, configurable: false },
    session_user: { points: 600, durationSec: 60, configurable: false },
    setup_ip: { points: 10, durationSec: 3600, configurable: false },
  };
  return cachedRules;
}

export type LimiterRegistry = { enabled: boolean; limiters: Map<RuleName, RateLimiterAbstract> };

/**
 * Backend `postgres` zatím NENÍ použitelný a selhává hlasitě.
 *
 * Požadavek P04→P03.4 z kapitoly 0.10 plánu žádá po P03 schéma `platform`
 * a tabulku `platform.rate_limits` ve tvaru `key varchar(255) PRIMARY KEY,
 * points integer NOT NULL DEFAULT 0, expire bigint`, tedy v tom, který čeká
 * `rate-limiter-flexible`. Ověřeno čtením migrace 0001 a schématu P03:
 * existuje `public.rate_limits` s ÚPLNĚ JINÝM tvarem (`bucket`,
 * `window_start`, `hits`, `expires_at`), což je ruční pevné okno pro jiného
 * spotřebitele. Knihovna by nad ním selhala až při prvním requestu.
 *
 * Tichý přechod na `memory` by byl horší než pád: při víc instancích má každá
 * vlastní počítadlo, takže skutečný strop je násobkem počtu instancí a nikdo
 * by se to nedozvěděl. Až P03 tabulku dodá, smaže se tenhle strážce a větev
 * pod ním je hotová.
 */
function assertPostgresBackendAvailable(): void {
  throw new Error(
    'RATE_LIMIT_BACKEND=postgres není použitelný: chybí schéma `platform` a tabulka ' +
      '`platform.rate_limits` ve tvaru pro rate-limiter-flexible (požadavek P04→P03.4). ' +
      'Existující `public.rate_limits` má jiný tvar a knihovna by nad ním selhala až ' +
      'za běhu. Nastavte RATE_LIMIT_BACKEND=memory, nebo doplňte migraci v P03.',
  );
}

export function createLimiterRegistry(opts: {
  backend: 'memory' | 'postgres';
  enabled: boolean;
}): LimiterRegistry {
  const limiters = new Map<RuleName, RateLimiterAbstract>();
  if (!opts.enabled) return { enabled: false, limiters };

  if (opts.backend === 'postgres') assertPostgresBackendAvailable();

  const pool =
    opts.backend === 'postgres'
      ? new pg.Pool({ connectionString: getConfig().DATABASE_URL, max: 2 })
      : undefined;

  /**
   * Vývojářský vypínač `LOGIN_THROTTLING_DISABLED` (viz `@mlain/core/identity/throttle`).
   * Pravidla přihlašovacích cest se prostě NEZAREGISTRUJÍ, takže `consumeAll`
   * je přeskočí svou existující větví `if (!limiter) continue`. Zbytek katalogu,
   * tedy API klíče, import kontaktů a odesílání kampaní, platí dál.
   */
  const skipLoginRules = loginThrottlingDisabled(getConfig());
  if (skipLoginRules) warnIfLoginThrottlingDisabled(getLogger(), getConfig());

  for (const [name, rule] of Object.entries(rateLimitRules()) as Array<[RuleName, Rule]>) {
    if (skipLoginRules && LOGIN_THROTTLE_RULE_NAMES.includes(name)) continue;
    limiters.set(
      name,
      opts.backend === 'postgres'
        ? new RateLimiterPostgres({
            storeClient: pool,
            tableName: 'rate_limits',
            schemaName: 'platform',
            // Tabulku zakládá migrace v P03. Knihovna ji nesmí vytvořit sama,
            // protože objekt mimo migraci je objekt, který nikdo neverzuje.
            tableCreated: true,
            keyPrefix: name,
            points: rule.points,
            duration: rule.durationSec,
          })
        : new RateLimiterMemory({
            keyPrefix: name,
            points: rule.points,
            duration: rule.durationSec,
          }),
    );
  }
  return { enabled: true, limiters };
}

export type Consumption = { rule: RuleName; key: string; cost?: number };

/**
 * Spotřebuje všechna uvedená pravidla. Hlavičky RateLimit-* se posílají
 * i u úspěšných odpovědí, aby klient viděl, jak blízko je limitu (4.5).
 */
export async function consumeAll(
  registry: LimiterRegistry,
  consumptions: readonly Consumption[],
): Promise<Record<string, string>> {
  if (!registry.enabled) return {};

  let tightest: { limit: number; remaining: number; resetSec: number } | null = null;

  for (const item of consumptions) {
    const limiter = registry.limiters.get(item.rule);
    if (!limiter) continue;
    const rule = rateLimitRules()[item.rule];
    try {
      const res = await limiter.consume(item.key, item.cost ?? 1);
      const candidate = {
        limit: rule.points,
        remaining: res.remainingPoints,
        resetSec: Math.ceil(res.msBeforeNext / 1000),
      };
      if (!tightest || candidate.remaining < tightest.remaining) tightest = candidate;
    } catch (rejection) {
      const res = rejection as { msBeforeNext?: number };
      if (typeof res.msBeforeNext !== 'number') throw rejection;
      throw new ApiError('rate_limited', {
        retryAfter: Math.max(1, Math.ceil(res.msBeforeNext / 1000)),
        params: { limit: rule.points, window_seconds: rule.durationSec },
      });
    }
  }

  if (!tightest) return {};
  return {
    'RateLimit-Limit': String(tightest.limit),
    'RateLimit-Remaining': String(Math.max(0, tightest.remaining)),
    'RateLimit-Reset': String(Math.max(0, tightest.resetSec)),
  };
}

/** Cesty vyloučené z limitů podle 4.5. Nic jiného vyloučené není. */
export const RATE_LIMIT_EXEMPT_PATHS = new Set(['/api/health', '/api/health/ready', '/metrics']);

/**
 * Jediná instance pro běh aplikace. Testy si vyrábějí vlastní přes
 * createLimiterRegistry.
 *
 * ODCHYLKA OD PLÁNU: plán ji měl jako `export const`. Tady je to líná funkce,
 * protože konstrukce čte konfiguraci a u konstanty by se to stalo při importu
 * modulu. Každý jednotkový test, který se `rate-limit.ts` jen dotkne, by pak
 * potřeboval kompletní prostředí.
 */
let registrySingleton: LimiterRegistry | null = null;

export function limiterRegistry(): LimiterRegistry {
  registrySingleton ??= createLimiterRegistry({
    backend: getConfig().RATE_LIMIT_BACKEND,
    enabled: getConfig().RATE_LIMIT_ENABLED,
  });
  return registrySingleton;
}
