import { z } from 'zod';
import {
  envBool,
  envCron,
  envCsv,
  envFloat,
  envInt,
  envPostgresUrl,
  envPreviousKeys,
  envSecretKey,
  envTimezone,
  envUrl,
} from './primitives';

/**
 * Absolutní cesta. Kontroluje se úvodním lomítkem, ne `path.isAbsolute()`:
 * ten by do modulu vrátil `node:path` a s ním i to, kvůli čemu se tahle
 * kontrola zavádí.
 */
function absolutePath() {
  return z
    .string()
    .min(1)
    .refine((value) => value.startsWith('/'), {
      message: 'musí být absolutní cesta začínající lomítkem, například /data',
    });
}

/** Část 1, kapitola 4.9, hlavní tabulka. Legenda "Kdo": W = web, K = worker, S = sender. */
export const platformShape = {
  APP_URL: envUrl(),
  SECRET_KEY: envSecretKey(),
  SECRET_KEY_PREVIOUS: envPreviousKeys().prefault(''),
  DATABASE_URL: envPostgresUrl(),
  DATABASE_URL_MIGRATOR: envPostgresUrl().optional(),
  DATABASE_URL_SENDER: envPostgresUrl().optional(),
  /**
   * Připojení pro systémové úlohy, které čtou NAPŘÍČ projekty (role
   * `mlain_maintenance`, politiky `maintenance_*` z migrace 0009).
   *
   * VOLITELNÁ ZÁMĚRNĚ a nedopočítává se výměnou uživatele v URL, na rozdíl od
   * `DATABASE_URL_SENDER`. Odvození by vyrobilo připojení s heslem aplikační
   * role, které pro `mlain_maintenance` neplatí, takže by instalace bez téhle
   * proměnné selhávala na autentizaci, tedy na jiné příčině, než jaká to
   * doopravdy je. Nenastavená proměnná znamená „skeny nepoběží", a to musí být
   * vidět z hlášky, ne z chyby přihlášení k databázi.
   *
   * Co se stane bez ní: aplikace naběhne, běžný provoz včetně okamžitého
   * odeslání kampaně funguje, ale plánovač, hlídač běžících kampaní, obnova po
   * kvótě, rekonciliace outboxu, rekontrola domén a úklid smazaných projektů
   * odmítnou běžet. Každá při prvním tiku řekne nahlas proč (viz
   * `withMaintenance` v `core/tx`), takže úloha skončí v chybě a jde dohledat.
   */
  DATABASE_URL_MAINTENANCE: envPostgresUrl().optional(),
  /**
   * Připojení pro výmaz podle článku 17 (role `mlain_gdpr`).
   *
   * Souhlasy jsou append only: migrace 0006 odebírá `mlain_app` právo `UPDATE`
   * i `DELETE` na `consents` a migrace 0005 dává `DELETE` jedině téhle roli.
   * Bez téhle proměnné tedy anonymizace kontaktu, tedy VÝCHOZÍ režim výmazu,
   * nedoběhne: poslední krok skončí chybou a celá transakce se zruší, takže
   * po žádosti subjektu nezůstane ani polovina anonymizovaného kontaktu.
   *
   * VOLITELNÁ ZÁMĚRNĚ a NEDOPOČÍTÁVÁ se výměnou uživatele v URL, ze stejného
   * důvodu jako `DATABASE_URL_MAINTENANCE`: odvozené připojení by neslo heslo
   * aplikační role a instalace by padala na autentizaci, tedy na jiné příčině,
   * než jaká to doopravdy je. Nenastavená proměnná znamená „výmaz nepoběží",
   * a to musí být vidět z hlášky, ne z chyby přihlášení k databázi.
   *
   * Role výjimku z izolace projektů NEMÁ. `consents` má jen politiku
   * `ws_isolation`, takže obálka `withGdpr` nastavuje `mlain.workspace_id`
   * stejně jako aplikační cesta a mimo svůj projekt nesmaže nic.
   */
  DATABASE_URL_GDPR: envPostgresUrl().optional(),
  DATABASE_POOL_MAX: envInt(1, 100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: envInt(1000, 600000).default(30000),
  MODE: z.enum(['web', 'worker', 'sender', 'all']).default('all'),
  PORT: envInt(1, 65535).default(3000),
  WORKER_HEALTH_PORT: envInt(1, 65535).default(3001),
  SENDER_HEALTH_PORT: envInt(1, 65535).default(3002),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  TRUST_PROXY: envInt(0, 5).default(0),
  DEFAULT_LOCALE: z.string().min(2).max(5).default('cs'),
  SUPPORTED_LOCALES: envCsv().prefault('cs,en'),
  DEFAULT_TIMEZONE: envTimezone().default('Europe/Prague'),
  SIGNUP_MODE: z.enum(['closed', 'invite', 'open']).default('closed'),
  SESSION_ABSOLUTE_TTL_DAYS: envInt(1, 365).default(30),
  SESSION_IDLE_TTL_DAYS: envInt(1, 365).default(14),
  MIGRATE_ON_START: envBool().prefault('true'),
  MIGRATE_LOCK_TIMEOUT_SECONDS: envInt(10, 3600).default(300),
  /**
   * Datové adresáře musí být ABSOLUTNÍ cesty.
   *
   * Dřív se relativní cesta dopočítávala v `loadConfig` přes `path.resolve()`.
   * Turbopack takový výraz neumí vyhodnotit a hlásil
   *
   *   Encountered unexpected file in NFT list
   *   A file was traced that indicates that the whole project was traced
   *   unintentionally.
   *
   * takže do serverového výstupu vystopoval celý projekt. Naměřeno: po
   * odstranění `path.resolve` z `load.ts` varování zmizelo a `.next/server`
   * klesl ze 73 na 71 MB. Ta velikost roste s projektem, takže je to spíš
   * netěsnost než jednorázová ztráta.
   *
   * Nikoho to neomezuje: v kontejneru je `/data`, v CI i ve vývoji se používají
   * absolutní cesty. Relativní cesta u datového adresáře navíc znamená, že
   * obsah instalace závisí na tom, odkud se proces spustil, což je past sama
   * o sobě.
   */
  DATA_DIR: absolutePath().default('/data'),
  UPLOADS_DIR: absolutePath().optional(),
  BACKUP_DIR: absolutePath().optional(),
  BACKUP_TARGET: z.enum(['local']).default('local'),
  BACKUP_SCHEDULE_CRON: envCron().default('0 3 * * *'),
  BACKUP_RETENTION_DAYS: envInt(1, 3650).default(14),
  AUDIT_RETENTION_MONTHS: envInt(1, 120).default(24),
  RATE_LIMIT_BACKEND: z.enum(['memory', 'postgres']).default('memory'),
  RATE_LIMIT_ENABLED: envBool().prefault('true'),
  RATE_LIMIT_API_READ: envInt(1, 1000000).default(1000),
  RATE_LIMIT_API_WRITE: envInt(1, 1000000).default(300),
  RATE_LIMIT_TRACK_KEY: envInt(1, 10000000).default(6000),
  RATE_LIMIT_TRACK_KEY_IP: envInt(1, 10000000).default(120),
  RATE_LIMIT_TRACK_PIXEL_IP: envInt(1, 10000000).default(600),
  // Dvě doplnění tabulky 4.5 části 1 podle požadavku 12.5.11 části 5. Obě
  // používá P10 a v tabulce 4.9 chyběly; RATE_LIMIT_IDENTIFY_IP navíc rovnou
  // v kódu limiteru, takže by tam byla hodnota undefined.
  RATE_LIMIT_IDENTIFY_IP: envInt(1, 10000000).default(30),
  RATE_LIMIT_TRACK_ANON: envInt(1, 10000000).default(600),
  /**
   * VYPÍNAČ BRZD PŘIHLAŠOVÁNÍ, VÝHRADNĚ PRO VÝVOJ.
   *
   * Ruční testování naráží na to, že brzdy proti hádání hesel jsou nastavené
   * na skutečný útok, ne na člověka, který se za minutu přihlásí desetkrát:
   * pravidlo `login_ip_email` pustí 5 pokusů za 300 sekund a po deseti
   * neúspěších se účet zamkne v databázi na 15 minut. Čekat tolik po každé
   * překlepnuté zkoušce nejde.
   *
   * Při `true` se vypnou VÝHRADNĚ ty brzdy, tedy limity přihlašovacích cest,
   * zamykání účtu a časová podlaha odpovědi. Ověření hesla, platnost relace
   * ani cokoliv jiného z autentizace se nemění.
   *
   * Výchozí hodnota je `false`, tedy plná ochrana: chybějící proměnná se chová
   * přesně jako dosud. V produkci (`NODE_ENV=production`) je hodnota `true`
   * chyba konfigurace a aplikace odmítne nastartovat, viz `cross-checks.ts`.
   * Když je zapnutá, hlásí to `warnIfLoginThrottlingDisabled` při každém startu.
   */
  LOGIN_THROTTLING_DISABLED: envBool().prefault('false'),
  WORKER_CONCURRENCY: envInt(1, 50).default(5),
  PGBOSS_SCHEMA: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,50}$/, 'jen alfanumerické znaky a podtržítko, do 50 znaků')
    .default('pgboss'),
  SENDER_ID: z.string().max(64).optional(),
  SENDER_CONCURRENCY: envInt(1, 1024).default(32),
  SENDER_BATCH_SIZE: envInt(1, 5000).default(100),
  SENDER_CLAIM_TTL_SECONDS: envInt(30, 3600).default(300),
  SENDER_POLL_INTERVAL_MS: envInt(100, 60000).default(1000),
  SHUTDOWN_GRACE_SECONDS: envInt(1, 300).default(25),
  /**
   * Absolutní adresa se schématem, ne holý host, i když se jmenuje „doména".
   *
   * Validace tu dřív byla jen `z.string().min(1)`, takže propustila i holý
   * host. Sender ho ale odmítá a z hodnoty skládá odkazy prostým spojením,
   * takže bez schématu by v e-mailu vznikl neklikatelný řetězec. Rozpor mezi
   * oběma jazyky se projevil tím, že výchozí hodnota vyrobená TypeScriptem
   * neprošla validací v Go a sender vůbec nenastartoval.
   */
  TRACKING_DOMAIN: z
    .string()
    .min(1)
    .refine(
      (value) => {
        try {
          const url = new URL(value);
          return (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== '';
        } catch {
          return false;
        }
      },
      {
        message:
          'musí být absolutní URL se schématem http nebo https, například https://mail.firma.cz',
      },
    )
    .optional(),
  WEBHOOK_ALLOW_PRIVATE_TARGETS: envBool().prefault('false'),
  // Horní mez se rovná počtu řádků tabulky odstupů v 3.8, ne pevnému číslu.
  // Vyšší hodnota by neměla definované zpoždění. Kritérium 36b.
  WEBHOOK_MAX_ATTEMPTS: envInt(1, 8).default(8),
  METRICS_ENABLED: envBool().prefault('false'),
  METRICS_TOKEN: z.string().min(32).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: envUrl().optional(),
  IMAGE_VERSION: z.string().min(1).default('0.0.0-dev'),
  // Bezpečnost, část 1, doplněno na základě nálezu části 3.
  SENDER_CREDENTIALS_MAX_RETRIES: envInt(1, 100).default(10),
  // Sender, část 4b. Musí platit SENDER_CLAIM_TTL_SECONDS > 4x tahle hodnota.
  SENDER_DISPATCH_TIMEOUT_SECONDS: envInt(1, 300).default(10),
  SENDER_REPLICAS: envInt(1, 100).default(1),
  SENDER_RATE_SAFETY: envFloat(0.1, 1).default(0.9),
  SENDER_MAX_ATTEMPTS: envInt(1, 20).default(5),
  SENDER_MAX_BACKOFF_SECONDS: envInt(1, 86400).default(3600),
  SENDER_FATAL_THRESHOLD: envInt(1, 100).default(3),
  SENDER_SMTP_MAX_CONNECTIONS: envInt(1, 32).default(4),
  SENDER_SMTP_MAX_MESSAGES_PER_CONN: envInt(1, 10000).default(100),
  SENDER_SMTP_CONNECT_TIMEOUT_SECONDS: envInt(1, 300).default(10),
  SENDER_SMTP_COMMAND_TIMEOUT_SECONDS: envInt(1, 300).default(30),
  SENDER_SMTP_DATA_TIMEOUT_SECONDS: envInt(1, 900).default(120),
  SENDER_PRECEDENCE_BULK: envBool().prefault('true'),
  SENDER_FEEDBACK_ID: envBool().prefault('true'),
  SENDER_TEST_TRACKING: envBool().prefault('false'),
};

export const PlatformConfigSchema = z.object(platformShape);
