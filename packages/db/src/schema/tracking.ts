// packages/db/src/schema/tracking.ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
import { bytea, cidr } from './_types';
import { workspaces } from './identity';
import { contacts } from './contacts';

/**
 * Řídká mapa "v kterých měsících má tenhle subjekt vůbec nějaká data".
 * Bez ní musí timeline prohledat všechny měsíční partition pozpátku,
 * i když kontakt existuje tři měsíce a partition je jich 37.
 */
export const webEventMonths = pgTable(
  'web_event_months',
  {
    workspaceId: uuid().notNull(),
    subjectKind: text().$type<'contact' | 'anonymous'>().notNull(),
    subjectId: uuid().notNull(),
    month: date().notNull(), // první den měsíce podle received_at, NE occurred_at
  },
  (t) => [
    primaryKey({
      name: 'pk_web_event_months',
      columns: [t.workspaceId, t.subjectKind, t.subjectId, t.month],
    }),
    check('ck_web_event_months__kind', sql`${t.subjectKind} IN ('contact','anonymous')`),
  ],
);

/** Aktuální vazba. Právě jeden řádek na (workspace_id, anonymous_id). */
export const identities = pgTable(
  'identities',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    anonymousId: uuid().notNull(),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    boundAt: timestamp({ withTimezone: true }),
    bindCount: integer().notNull().default(0),
    firstSeen: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_identities', columns: [t.workspaceId, t.anonymousId] }),
    // Reverzní pohled: která anonymní ID patří kontaktu. Kontakt jich může mít
    // víc (jiný prohlížeč, jiné zařízení). Index, ne tabulka.
    index('idx_identities__contact')
      .on(t.workspaceId, t.contactId)
      .where(sql`${t.contactId} IS NOT NULL`),
  ],
);

/**
 * Historie vazeb, append only. Umožňuje odpovědět "komu patřila návštěva
 * v 14:07", i když se vazba později změnila (sdílený počítač).
 */
export const identityBindings = pgTable(
  'identity_bindings',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid().notNull(),
    anonymousId: uuid().notNull(),
    contactId: uuid(), // NULL = odvázání (reset)
    validFrom: timestamp({ withTimezone: true }).notNull(),
    source: text().notNull(),
    evidence: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ck_identity_bindings__source',
      sql`${t.source} IN
    ('email_click','sdk_identify','server_api','form','reset')`,
    ),
    index('idx_identity_bindings__lookup').on(t.workspaceId, t.anonymousId, t.validFrom.desc()),
  ],
);

/** Záznam o doplnění historie ke kontaktu. Bez něj nejde slučování vrátit. */
export const identityMerges = pgTable(
  'identity_merges',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    anonymousId: uuid().notNull(),
    contactId: uuid().notNull(),
    bindingId: uuid()
      .notNull()
      .references(() => identityBindings.id),
    windowFrom: timestamp({ withTimezone: true }).notNull(),
    windowTo: timestamp({ withTimezone: true }).notNull(),
    eventsTotal: integer().notNull().default(0),
    status: text().notNull().default('pending'),
    revertedAt: timestamp({ withTimezone: true }),
    revertedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ck_identity_merges__status',
      sql`${t.status} IN
    ('pending','running','completed','truncated','reverted','failed')`,
    ),
    index('idx_identity_merges__contact').on(t.workspaceId, t.contactId, t.createdAt.desc()),
  ],
);

/**
 * Jednorázovost identifikačního tokenu. Token je bezstavově podepsaný,
 * jednorázovost vynucuje unikátní klíč nonce. Řádky se mažou po expiraci.
 * RLS tahle tabulka NEMÁ: nemá workspace_id, klíčem je náhodný nonce
 * a řádek žije 15 minut.
 */
export const identityTokenUses = pgTable(
  'identity_token_uses',
  {
    nonce: bytea().primaryKey(), // přesně 8 bajtů
    usedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    check('ck_identity_token_uses__nonce_len', sql`octet_length(${t.nonce}) = 8`),
    index('idx_identity_token_uses__expiry').on(t.expiresAt),
  ],
);

/**
 * Domény, na kterých smí běžet SDK a na které se smí přidat ml_token.
 * Bez zápisu v téhle tabulce SDK odmítne startovat a redirect token nepřidá.
 */
export const trackingDomains = pgTable(
  'tracking_domains',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    host: text().notNull(), // lowercase, bez schématu a portu
    includeSubdomains: boolean().notNull().default(false),
    verifiedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_tracking_domains__host', sql`${t.host} ~ '^[a-z0-9.-]{1,253}$'`),
    uniqueIndex('uq_tracking_domains__workspace_host').on(t.workspaceId, t.host),
  ],
);

/**
 * Rollup na kontakt. Řádek se zakládá LÍNĚ, až při první události kontaktu.
 * Kontakt, kterému se nikdy nic neposlalo, řádek nemá a segmentační dotaz
 * proto musí být LEFT JOIN s COALESCE, ne INNER JOIN. Jinak z presetu
 * "nikdy neotevřel" vypadnou právě ti nejnovější kontakti.
 */
export const contactEngagement = pgTable(
  'contact_engagement',
  {
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    lastSentAt: timestamp({ withTimezone: true }),
    lastDeliveredAt: timestamp({ withTimezone: true }),
    lastOpenAt: timestamp({ withTimezone: true }),
    lastClickAt: timestamp({ withTimezone: true }),
    lastBounceAt: timestamp({ withTimezone: true }),

    sentTotal: integer().notNull().default(0),
    deliveredTotal: integer().notNull().default(0),
    opensTotal: integer().notNull().default(0),
    clicksTotal: integer().notNull().default(0),
    bouncesTotal: integer().notNull().default(0),

    sent7d: integer().notNull().default(0),
    sent30d: integer().notNull().default(0),
    sent90d: integer().notNull().default(0),
    opens7d: integer().notNull().default(0),
    opens30d: integer().notNull().default(0),
    opens90d: integer().notNull().default(0),
    clicks7d: integer().notNull().default(0),
    clicks30d: integer().notNull().default(0),
    clicks90d: integer().notNull().default(0),

    consecutiveNoOpen: integer().notNull().default(0),
    consecutiveNoClick: integer().notNull().default(0),

    // Klouzavá okna 7, 30 a 90 dní SE NEDAJÍ udržovat jen přičítáním. Bez tohohle
    // sloupce by je nešlo přepočítávat přírůstkově a musely by se počítat
    // pokaždé znovu přes všech pět milionů kontaktů.
    windowsRecomputedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Klíč je (workspace_id, contact_id), ne jen contact_id: se samotným
    // contact_id by každý dotaz musel workspace_id dohledávat joinem.
    primaryKey({ name: 'pk_contact_engagement', columns: [t.workspaceId, t.contactId] }),
    // NULLS FIRST je podstatné: kontakt, který nikdy neotevřel, má NULL a musí
    // v dotazu "neaktivní 90+ dní" vyjít. Bez explicitního pořadí by dotaz
    // WHERE last_open_at IS NULL OR last_open_at < ... index nevyužil pro obě větve.
    index('idx_contact_engagement__ws_last_open').on(t.workspaceId, t.lastOpenAt.nullsFirst()),
    index('idx_contact_engagement__ws_no_open').on(t.workspaceId, t.consecutiveNoOpen.desc()),
    index('idx_contact_engagement__ws_last_click').on(t.workspaceId, t.lastClickAt.nullsFirst()),
    index('idx_contact_engagement__stale_windows')
      .on(t.windowsRecomputedAt)
      .where(sql`${t.sent90d} > 0 OR ${t.opens90d} > 0 OR ${t.clicks90d} > 0`),
  ],
);

/** Jeden řádek na kampaň. Aktualizuje se dávkově, nikdy per event. */
export const campaignStats = pgTable(
  'campaign_stats',
  {
    workspaceId: uuid().notNull(),
    campaignId: uuid().primaryKey(),

    materialized: bigint({ mode: 'number' }).notNull().default(0),
    sent: bigint({ mode: 'number' }).notNull().default(0),
    failed: bigint({ mode: 'number' }).notNull().default(0),
    skipped: bigint({ mode: 'number' }).notNull().default(0),
    delivered: bigint({ mode: 'number' }).notNull().default(0),
    bouncedHard: bigint({ mode: 'number' }).notNull().default(0),
    bouncedSoft: bigint({ mode: 'number' }).notNull().default(0),
    complained: bigint({ mode: 'number' }).notNull().default(0),
    unsubscribed: bigint({ mode: 'number' }).notNull().default(0),

    opensTotal: bigint({ mode: 'number' }).notNull().default(0),
    opensUnique: bigint({ mode: 'number' }).notNull().default(0),
    opensUniqueHuman: bigint({ mode: 'number' }).notNull().default(0),
    opensUniqueApple: bigint({ mode: 'number' }).notNull().default(0),
    clicksTotal: bigint({ mode: 'number' }).notNull().default(0),
    clicksUnique: bigint({ mode: 'number' }).notNull().default(0),
    clicksUniqueHuman: bigint({ mode: 'number' }).notNull().default(0),
    clicksScanner: bigint({ mode: 'number' }).notNull().default(0),

    firstEventAt: timestamp({ withTimezone: true }),
    lastEventAt: timestamp({ withTimezone: true }),
    // Nejvyšší zpracované messages.sent_at. Průběh odesílání se čte přírůstkově
    // podle něj, ne z událostí typu 'sent', které se právě proto zrušily.
    progressWatermarkAt: timestamp({ withTimezone: true }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    version: bigint({ mode: 'number' }).notNull().default(0), // inkrement pro SSE
  },
  (t) => [index('idx_campaign_stats__workspace').on(t.workspaceId, t.updatedAt.desc())],
);

/** Průběh v čase pro graf v reportu a pro živé sledování odesílání. */
export const campaignStatsBuckets = pgTable(
  'campaign_stats_buckets',
  {
    campaignId: uuid().notNull(),
    workspaceId: uuid().notNull(),
    bucketAt: timestamp({ withTimezone: true }).notNull(), // zaokrouhleno dolů na 5 minut
    sent: integer().notNull().default(0),
    delivered: integer().notNull().default(0),
    opensUnique: integer().notNull().default(0),
    clicksUnique: integer().notNull().default(0),
    bounced: integer().notNull().default(0),
  },
  (t) => [
    // workspace_id v čele ze stejného důvodu jako u campaign_link_stats:
    // politika RLS se vyhodnocuje nad indexovaným sloupcem a upsert z jobu
    // nemůže omylem trefit cizí projekt.
    primaryKey({
      name: 'pk_campaign_stats_buckets',
      columns: [t.workspaceId, t.campaignId, t.bucketAt],
    }),
  ],
);

export const campaignLinkStats = pgTable(
  'campaign_link_stats',
  {
    workspaceId: uuid().notNull(),
    campaignId: uuid().notNull(),
    // = campaign_links.id. Typ je uuid, NE int: do int sloupce se UUID neuloží
    // a job plnící statistiku odkazů by na prvním kliku spadl s chybou typu.
    linkId: uuid().notNull(),
    clicksTotal: bigint({ mode: 'number' }).notNull().default(0),
    clicksUnique: bigint({ mode: 'number' }).notNull().default(0),
    clicksHuman: bigint({ mode: 'number' }).notNull().default(0),
  },
  (t) => [
    // workspace_id je v klíči proto, že se politika RLS vyhodnocuje nad
    // indexovaným sloupcem a upsert z jobu nemůže omylem trefit cizí projekt.
    primaryKey({
      name: 'pk_campaign_link_stats',
      columns: [t.workspaceId, t.campaignId, t.linkId],
    }),
  ],
);

/**
 * Cache stažených IP rozsahů obrazových proxy. Globální provozní data,
 * žádný obsah zákazníka, proto bez workspace_id a bez RLS.
 */
export const proxyRanges = pgTable(
  'proxy_ranges',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    provider: text().notNull(),
    cidr: cidr().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ck_proxy_ranges__provider',
      sql`${t.provider} IN
    ('apple_private_relay','google','manual')`,
    ),
    index('idx_proxy_ranges__provider').on(t.provider),
    index('idx_proxy_ranges__cidr').using('gist', sql`${t.cidr} inet_ops`),
  ],
);

export type WebEventMonth = typeof webEventMonths.$inferSelect;
export type WebEventMonthInsert = typeof webEventMonths.$inferInsert;
export type Identity = typeof identities.$inferSelect;
export type IdentityInsert = typeof identities.$inferInsert;
export type IdentityBinding = typeof identityBindings.$inferSelect;
export type IdentityBindingInsert = typeof identityBindings.$inferInsert;
export type IdentityMerge = typeof identityMerges.$inferSelect;
export type IdentityMergeInsert = typeof identityMerges.$inferInsert;
export type IdentityTokenUse = typeof identityTokenUses.$inferSelect;
export type IdentityTokenUseInsert = typeof identityTokenUses.$inferInsert;
export type TrackingDomain = typeof trackingDomains.$inferSelect;
export type TrackingDomainInsert = typeof trackingDomains.$inferInsert;
export type ContactEngagement = typeof contactEngagement.$inferSelect;
export type ContactEngagementInsert = typeof contactEngagement.$inferInsert;
export type CampaignStats = typeof campaignStats.$inferSelect;
export type CampaignStatsInsert = typeof campaignStats.$inferInsert;
export type CampaignStatsBucket = typeof campaignStatsBuckets.$inferSelect;
export type CampaignStatsBucketInsert = typeof campaignStatsBuckets.$inferInsert;
export type CampaignLinkStats = typeof campaignLinkStats.$inferSelect;
export type CampaignLinkStatsInsert = typeof campaignLinkStats.$inferInsert;
export type ProxyRange = typeof proxyRanges.$inferSelect;
export type ProxyRangeInsert = typeof proxyRanges.$inferInsert;
