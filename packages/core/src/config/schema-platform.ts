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

/** Část 1, kapitola 4.9, hlavní tabulka. Legenda "Kdo": W = web, K = worker, S = sender. */
export const platformShape = {
  APP_URL: envUrl(),
  SECRET_KEY: envSecretKey(),
  SECRET_KEY_PREVIOUS: envPreviousKeys().prefault(''),
  DATABASE_URL: envPostgresUrl(),
  DATABASE_URL_MIGRATOR: envPostgresUrl().optional(),
  DATABASE_URL_SENDER: envPostgresUrl().optional(),
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
  DATA_DIR: z.string().min(1).default('/data'),
  UPLOADS_DIR: z.string().min(1).optional(),
  BACKUP_DIR: z.string().min(1).optional(),
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
  TRACKING_DOMAIN: z.string().min(1).optional(),
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
