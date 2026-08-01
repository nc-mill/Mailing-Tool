// packages/db/src/schema/platform.ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from './_types';
import { workspaces } from './identity';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    fingerprint: bytea().notNull(), // SHA-256(method|path|kanonické tělo)
    status: text().$type<'in_progress' | 'completed'>().notNull(),
    responseStatus: integer(),
    responseBody: jsonb(),
    lockedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'pk_idempotency_keys', columns: [t.workspaceId, t.key] }),
    check('ck_idempotency_keys__status', sql`${t.status} IN ('in_progress','completed')`),
    check('ck_idempotency_keys__key_len', sql`length(${t.key}) BETWEEN 8 AND 255`),
    index('idx_idempotency_keys__expires_at').on(t.expiresAt),
  ],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    description: text().notNull().default(''),
    eventTypes: text().array().notNull(),
    secretEncrypted: text().notNull(), // obálka enc:v1:<base64>, context 'webhook_secret'
    status: text().$type<'active' | 'disabled'>().notNull().default('active'),
    disabledReason: text(),
    disabledAt: timestamp({ withTimezone: true }),
    consecutiveFailures: integer().notNull().default(0),
    lastSuccessAt: timestamp({ withTimezone: true }),
    lastFailureAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('ck_webhook_endpoints__status', sql`${t.status} IN ('active','disabled')`),
    check('ck_webhook_endpoints__event_types', sql`cardinality(${t.eventTypes}) BETWEEN 1 AND 50`),
    // Fan-out události: "které aktivní endpointy v tomhle projektu chtějí tenhle typ".
    index('idx_webhook_endpoints__ws_active')
      .on(t.workspaceId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'active'`),
    index('idx_webhook_endpoints__event_types').using('gin', t.eventTypes),
  ],
);

/**
 * Jeden řádek, stav instalace. Trik s boolean primárním klíčem a CHECK (id = true)
 * je standardní: bez něj se dřív nebo později objeví dva řádky konfigurace
 * a nikdo nebude vědět, který platí.
 */
export const systemSettings = pgTable(
  'system_settings',
  {
    id: boolean().primaryKey().default(true),
    installationId: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    schemaVersion: integer().notNull(),
    secretKeyFingerprint: text().notNull(),
    // Rozhodnutí R7: sloupec doplněný proti DDL části 1. Migrační runner do něj
    // počítá neúspěchy migrace (klíč migration_failures), protože pravidlo
    // "po třech neúspěších režim údržby" jinak nemá kam zapsat stav.
    settings: jsonb().notNull().default({}),
    setupCompletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('ck_system_settings__singleton', sql`${t.id} = true`)],
);

/**
 * Pokolení šifrovacího klíče (rozhodnutí R28).
 *
 * Bez téhle tabulky nemá `mlain doctor` (P16) jak poznat rozdíl mezi
 * „klíč pokolení 2 existuje" a „pod číslem 2 je dnes jiný klíč". Otisky
 * v suppressions se po výmazu přepočítat NEDAJÍ, takže prohození SECRET_KEY
 * a SECRET_KEY_PREVIOUS po obnově ze zálohy znamená, že vymazaný člověk
 * projde suppression kontrolou a dostane e-mail. Nic přitom nespadne
 * a nic se nezaloguje: je to nejtišší porucha, jakou produkt má.
 *
 * `fingerprint` je otisk SAMOTNÉHO KLÍČE, ne adresy: SHA-256 z odvozeného
 * podklíče, stejný recept jako system_settings.secret_key_fingerprint.
 * Řádky zapisuje POST /api/v1/setup a rotace klíče (P16), nikdy migrace.
 */
export const secretKeyGenerations = pgTable(
  'secret_key_generations',
  {
    keyId: smallint().primaryKey(),
    fingerprint: text().notNull(),
    introducedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('ck_secret_key_generations__key_id', sql`${t.keyId} >= 0`),
    // Dva různé klíče pod týmž otiskem nedávají smysl a dva různé otisky
    // pod týmž key_id jsou přesně ta porucha, kterou tabulka odhaluje.
    uniqueIndex('uq_secret_key_generations__fingerprint').on(t.fingerprint),
  ],
);

/**
 * Čítače pro RATE_LIMIT_BACKEND=postgres. Preflight P04 tabulku vyžaduje
 * a bez ní rate limiting nad Postgresem nejde spustit vůbec.
 *
 * Rozsah limitu nese TEXTOVÝ KLÍČ `scope:identifier:window`, ne sloupec
 * workspace_id (rozhodnutí R36). Přihlašovací a IP limity žádný workspace
 * kontext nemají, takže by je politika s WITH CHECK vyhodnoceným jako NULL
 * odmítla a limiter by přestal fungovat právě na přihlašování, tedy tam,
 * kde na něm stojí ochrana proti hádání hesel. Tabulka je proto na whitelistu
 * a RLS se na ni nezapíná; nese čítače, ne obsah zákazníka, a je to tentýž
 * tvar, jaký už mají sessions a password_reset_tokens.
 *
 * window_start je začátek okna zaokrouhlený dolů, NE now(): dva zápisy
 * v témž okně musí kolidovat, jinak by ON CONFLICT nikdy nesepnul a limiter
 * by počítal každý požadavek jako první. Je to táž past, kterou plán řeší
 * u provider_event_receipts (rozhodnutí R22).
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    hits: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'pk_rate_limits', columns: [t.bucket, t.windowStart] }),
    // Tvarová pojistka. Bez ní by překlep ve jméně rozsahu vyrobil vlastní
    // kbelík, který nikdy nic neomezí, a nikdo by si toho nevšiml, protože
    // "limit se nepřekročil" vypadá stejně jako "limit se nepočítá".
    check(
      'ck_rate_limits__bucket',
      sql`${t.bucket} ~
    '^(user|workspace|ip|global):[^:]{1,128}:[a-z0-9_]{1,32}$'`,
    ),
    check('ck_rate_limits__hits', sql`${t.hits} >= 0`),
    // Úklid prošlých oken. Bez indexu by mazací dotaz skenoval celou tabulku.
    index('idx_rate_limits__expires').on(t.expiresAt),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type IdempotencyKeyInsert = typeof idempotencyKeys.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookEndpointInsert = typeof webhookEndpoints.$inferInsert;
export type SystemSettings = typeof systemSettings.$inferSelect;
export type SystemSettingsInsert = typeof systemSettings.$inferInsert;
export type SecretKeyGeneration = typeof secretKeyGenerations.$inferSelect;
export type SecretKeyGenerationInsert = typeof secretKeyGenerations.$inferInsert;
export type RateLimit = typeof rateLimits.$inferSelect;
export type RateLimitInsert = typeof rateLimits.$inferInsert;
