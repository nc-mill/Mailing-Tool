// packages/db/src/schema/identity.ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, citext, inet } from './_types';

/**
 * Podmnožina BCP 47: jazyk[-Písmo][-Region]. Projde cs, en-GB, zh-Hant,
 * sr-Latn-RS i es-419. Rozšířené tagy (-u-, -x-) neprojdou schválně: v katalogu
 * zpráv nemají co dělat a jméno souboru messages/<locale>.json je součástí cesty.
 * Je to hrubá pojistka proti překlepu, přesnou validaci proti SUPPORTED_LOCALES
 * dělá aplikace, protože jen ona zná seznam existujících katalogů.
 */
const LOCALE_CHECK = sql.raw(`~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$'`);

export const users = pgTable(
  'users',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    email: citext().notNull(),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    passwordHash: text().notNull(), // PHC řetězec argon2id
    passwordChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    name: text().notNull().default(''),
    // Defaulty jsou POJISTKA, ne konfigurace. Zdrojem hodnoty jsou DEFAULT_LOCALE
    // a DEFAULT_TIMEZONE a aplikace obě vždy vyplňuje explicitně, i když se rovnají.
    locale: text().notNull().default('cs'),
    timezone: text().notNull().default('Europe/Prague'),
    status: text().$type<'active' | 'suspended'>().notNull().default('active'),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('ck_users__status', sql`${t.status} IN ('active','suspended')`),
    check('ck_users__locale', sql`${t.locale} ${LOCALE_CHECK}`),
    // Přihlášení hledá podle e-mailu. Částečný, aby šlo znovu založit účet po smazání.
    uniqueIndex('uq_users__email')
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea().notNull(), // SHA-256 z tokenu, 32 B. Syrový token se neukládá.
    csrfSecret: bytea().notNull(), // 32 B
    userAgent: text().notNull().default(''),
    ip: inet(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    absoluteExpiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: text(),
  },
  (t) => [
    // Ověření session na každém requestu: jediný lookup podle hashe.
    uniqueIndex('uq_sessions__token_hash').on(t.tokenHash),
    // "Odhlásit ze všech zařízení" a výpis relací uživatele.
    index('idx_sessions__user_id')
      .on(t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    // Úklidový job maže expirované relace.
    index('idx_sessions__absolute_expires_at').on(t.absoluteExpiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_password_reset_tokens__token_hash').on(t.tokenHash),
    // Invalidace starých tokenů při vydání nového a při změně hesla.
    index('idx_password_reset_tokens__user_id').on(t.userId),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text().notNull(),
    slug: text().notNull(),
    locale: text().notNull().default('cs'),
    timezone: text().notNull().default('Europe/Prague'),
    addressForm: text().$type<'formal' | 'informal'>().notNull().default('formal'),
    /**
     * Řeší projekt oslovení a 5. pád vůbec?
     *
     * Vypnuto znamená, že se oslovení nikde nenabízí ani nezobrazuje: zmizí sloupec
     * v seznamu kontaktů, blok na detailu, náhled ve formuláři, obrazovka kontroly
     * 5. pádu, pole v segmentech, nabídka v editoru i volba vykání a tykání
     * (`addressForm` totiž nemá jiného konzumenta než skládání oslovení).
     *
     * SLOUPCE KONTAKTŮ SE TÍM NEMAŽOU a `resolveName` běží dál při každém zápisu.
     * Je to čistě zobrazovací přepínač: kdyby přestal počítat, znamenalo by zapnutí
     * zpátky přepočet celé databáze a ručně potvrzené tvary by se ztratily.
     * Šablony, které `{{ contact.greeting }}` už obsahují, proto dál renderují
     * správnou větu, viz `contacts/fields/catalog.ts`.
     */
    greetingEnabled: boolean().notNull().default(true),
    settings: jsonb().notNull().default({}),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('ck_workspaces__slug', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check('ck_workspaces__locale', sql`${t.locale} ${LOCALE_CHECK}`),
    check('ck_workspaces__address_form', sql`${t.addressForm} IN ('formal','informal')`),
    // Slug je v URL, musí být unikátní mezi živými workspaces.
    uniqueIndex('uq_workspaces__slug')
      .on(t.slug)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().$type<'owner' | 'admin' | 'editor' | 'viewer'>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_memberships', columns: [t.workspaceId, t.userId] }),
    check('ck_memberships__role', sql`${t.role} IN ('owner','admin','editor','viewer')`),
    // Přepínač projektů: "které workspaces vidí tento uživatel".
    index('idx_memberships__user_id').on(t.userId),
    // Nejvýš jeden owner na workspace NENÍ vynuceno indexem, vynucuje ho aplikace (P04).
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext().notNull(),
    role: text().$type<'owner' | 'admin' | 'editor' | 'viewer'>().notNull(),
    tokenHash: bytea().notNull(),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_invitations__role', sql`${t.role} IN ('owner','admin','editor','viewer')`),
    uniqueIndex('uq_invitations__token_hash').on(t.tokenHash),
    // Jedna aktivní pozvánka na e-mail a workspace, jinak se nedá poznat, která platí.
    uniqueIndex('uq_invitations__ws_email_pending')
      .on(t.workspaceId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: text().$type<'secret' | 'public'>().notNull().default('secret'),
    prefix: text().notNull(), // base32, 8 znaků u secret, 16 u public
    secretHash: bytea(), // SHA-256, NULL pro kind='public'
    // Odklad při rotaci klíče (grace_seconds). Bez těchhle dvou sloupců je rotace
    // nutně okamžitá: integrace zákazníka přestane fungovat ve chvíli, kdy si
    // v UI vygeneruje nový klíč, a jediná náhradní cesta by byl druhý řádek
    // v api_keys, který rozbije uq_api_keys__prefix i ověřovací algoritmus,
    // protože ten dělá podle prefixu JEDINÝ lookup.
    previousSecretHash: bytea(),
    previousExpiresAt: timestamp({ withTimezone: true }),
    scopes: text().array().notNull().default([]),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_api_keys__kind', sql`${t.kind} IN ('secret','public')`),
    check(
      'ck_api_keys__secret_hash',
      sql`
    (${t.kind} = 'secret' AND ${t.secretHash} IS NOT NULL) OR
    (${t.kind} = 'public' AND ${t.secretHash} IS NULL)`,
    ),
    // Délka prefixu je vázaná na druh klíče. Bez tohohle omezení by šlo založit
    // veřejný klíč s osmiznakovým prefixem a ověřovací algoritmus by ho nerozpoznal.
    check(
      'ck_api_keys__prefix',
      sql`
    (${t.kind} = 'secret' AND ${t.prefix} ~ '^[a-z2-7]{8}$') OR
    (${t.kind} = 'public' AND ${t.prefix} ~ '^[a-z2-7]{16}$')`,
    ),
    // Předchozí hash a konec jeho odkladu drží nebo padají spolu. Hash bez času
    // by platil navždy, což je z rotace klíče, která má zvýšit bezpečnost,
    // přesně naopak: zneplatněný klíč by fungoval doživotně.
    check(
      'ck_api_keys__previous_secret',
      sql`
    (${t.previousSecretHash} IS NULL AND ${t.previousExpiresAt} IS NULL) OR
    (${t.previousSecretHash} IS NOT NULL AND ${t.previousExpiresAt} IS NOT NULL)`,
    ),
    // Ověření klíče: jediný lookup podle prefixu, pak časově konstantní porovnání hashe.
    uniqueIndex('uq_api_keys__prefix').on(t.prefix),
    index('idx_api_keys__workspace_id')
      .on(t.workspaceId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export type User = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type PasswordResetTokenInsert = typeof passwordResetTokens.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceInsert = typeof workspaces.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type MembershipInsert = typeof memberships.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type InvitationInsert = typeof invitations.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiKeyInsert = typeof apiKeys.$inferInsert;
