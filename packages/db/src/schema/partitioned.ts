// packages/db/src/schema/partitioned.ts
//
// POZOR: tenhle soubor NENÍ v seznamu schema v drizzle.config.ts a nikdy tam
// být nesmí. Devět tabulek níž je PARTITION BY RANGE a drizzle-kit by je
// vygeneroval jako obyčejné tabulky. To by prošlo, PARTITION BY by zmizel
// a projevilo by se to až u zákazníka na objemu dat. DDL píše migrace 0003.
import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { inet } from './_types';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    // NULL u globálních akcí (user.login, user.password_changed). Právě proto
    // má audit_log vlastní politiku ws_isolation_audit: s obyčejnou ws_isolation
    // by INSERT globálního záznamu selhal na WITH CHECK a vzal s sebou celou
    // transakci, takže by se NEULOŽILA ani změna hesla.
    workspaceId: uuid(),
    actorType: text().$type<'user' | 'api_key' | 'system'>().notNull(),
    actorId: uuid(),
    actorLabel: text().notNull().default(''), // e-mail nebo název klíče v okamžiku akce
    action: text().notNull(),
    targetType: text(),
    targetId: uuid(),
    ip: inet(),
    userAgent: text(),
    requestId: text(),
    metadata: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'pk_audit_log', columns: [t.id, t.createdAt] })],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    workspaceId: uuid().notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'pk_webhook_events', columns: [t.id, t.createdAt] })],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    workspaceId: uuid().notNull(),
    endpointId: uuid().notNull(),
    eventId: uuid().notNull(),
    eventType: text().notNull(),
    status: text().notNull().default('pending'),
    attempt: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }),
    responseStatus: integer(),
    responseBodySnippet: text(), // max 2 kB
    durationMs: integer(),
    errorCode: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    // PARTIČNÍ KLÍČ A ZÁROVEŇ DRUHÁ SLOŽKA KLÍČE UDÁLOSTI. DEFAULT now() tu
    // SCHVÁLNĚ NENÍ: hodnota se přebírá z webhook_events.created_at, takže
    // (event_id, created_at) je celý klíč události a doručení leží ve stejném
    // měsíčním okně jako událost, ze které vzniklo.
    //
    // Bez toho by unikátní index uq_webhook_deliveries__event_endpoint
    // negarantoval nic (rozhodnutí R22): jeho třetí složkou musí být partiční
    // klíč, a kdyby to bylo now(), prošly by dva fan-outy téže události
    // a příjemce by dostal webhook dvakrát.
    //
    // Opakovaný pokus o doručení je UPDATE téhož řádku (attempt + 1),
    // ne nový řádek. Jeden řádek na dvojici (událost, endpoint).
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ name: 'pk_webhook_deliveries', columns: [t.id, t.createdAt] })],
);

/**
 * OUTBOX. Kontraktní podmnožinu sloupců, stavů a dotazů vlastní zmrazený
 * kontrakt (část 1, 4.10.1). Název, typ ani sémantika kontraktního sloupce
 * se NESMÍ změnit. Přidávat sloupce a indexy je dovolené.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    workspaceId: uuid().notNull(),
    campaignId: uuid(), // NULL = nekampáňová zpráva, rezerva pro MVP 1
    contentVariantId: uuid(), // NULL = obsah ze sloupců kampaně, rezerva pro MVP 1
    // Výčet drží `ck_messages__kind` (migrace 0003, rozšířeno v 0016).
    kind: text()
      .$type<'campaign' | 'test' | 'transactional' | 'automation'>()
      .notNull()
      .default('campaign'),
    /**
     * GENEROVANÝ (migrace 0010, požadavek R-P03.7 plánu P13). Nikdo do něj
     * nezapisuje, PostgreSQL ho počítá jako
     * `CASE WHEN kind = 'campaign' THEN campaign_id END`.
     *
     * Nese ho cizí klíč `fk_messages__campaign_audience`, dřív vedený přímo přes
     * `campaign_id`. U testovací zprávy je hodnota NULL, takže se kontrola podle
     * MATCH SIMPLE přeskočí a test jde odeslat i ze skryté kampaně, která žádné
     * materializované publikum nemá. Pro `kind = 'campaign'` se cizí klíč chová
     * beze změny, takže invariant I1 platí dál.
     */
    audienceCampaignId: uuid().generatedAlwaysAs(
      sql`CASE WHEN kind = 'campaign' THEN campaign_id END`,
    ),
    contactId: uuid().notNull(),
    email: text().notNull(), // text, ne citext: Go nemá pro citext nativní typ
    renderData: jsonb().notNull().default({}),
    status: text()
      .$type<'pending' | 'claimed' | 'sent' | 'failed' | 'skipped'>()
      .notNull()
      .default('pending'),
    claimedBy: text(),
    claimedAt: timestamp({ withTimezone: true }),
    claimExpiresAt: timestamp({ withTimezone: true }),
    attempts: smallint().notNull().default(0),
    ambiguousCount: smallint().notNull().default(0),
    dispatchStartedAt: timestamp({ withTimezone: true }),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    providerMessageId: text(),
    sentAt: timestamp({ withTimezone: true }),
    errorCode: text(),
    errorDetail: text(),
    // INVARIANT I1: všechny řádky jednoho materializačního běhu batch kampaně
    // mají created_at rovné campaigns.audience_built_at. Sender created_at
    // NIKDY nemění a nemá na něj sloupcový grant.
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'pk_messages', columns: [t.id, t.createdAt] })],
);

export const messageEvents = pgTable(
  'message_events',
  {
    id: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    workspaceId: uuid().notNull(),
    messageId: uuid().notNull(),
    // Druhá složka primárního klíče zprávy. Bez ní by každý skok z události
    // na zprávu prohledal všechny partition.
    messageCreatedAt: timestamp({ withTimezone: true }).notNull(),
    campaignId: uuid().notNull(),
    contactId: uuid(), // NULL až po GDPR výmazu, viz erasedAt
    erasedAt: timestamp({ withTimezone: true }),
    // Adresa v okamžiku odeslání. NEPOVINNÁ (rozhodnutí R33): čte ji jediný
    // index, a ten je částečný přes odrazy a stížnosti. U otevření a prokliku
    // by to byla kopie osobního údaje na každém řádku desetimilionové tabulky,
    // kterou pak musí výmaz podle článku 17 procházet. Povinnost drží
    // ck_message_events__recipient jen pro doručovací rodinu.
    recipient: text(),
    type: text().notNull(),
    subtype: text(), // 'hard','soft','transient'; u open a click třída
    linkId: uuid(), // campaign_links.id
    // GENEROVANÝ (rozhodnutí R32). Škálu vlastní P03, nikdo ji nezapisuje,
    // takže se nemůže rozejít. Bez větve ELSE schválně: nový typ v CHECK bez
    // ramene tady dá NULL a NOT NULL ho odmítne, tedy hlasitě.
    // Nula znamená "neúčastní se odvození stavu doručení".
    rank: smallint().notNull().generatedAlwaysAs(sql`CASE type
      WHEN 'open'                 THEN 0
      WHEN 'click'                THEN 0
      WHEN 'unsubscribe'          THEN 0
      WHEN 'circuit_breaker_open' THEN 0
      WHEN 'sent'                 THEN 20
      WHEN 'delivery_delayed'     THEN 25
      WHEN 'delivered'            THEN 30
      WHEN 'bounced_soft'         THEN 60
      WHEN 'bounced_hard'         THEN 80
      WHEN 'complained'           THEN 85
      WHEN 'rejected'             THEN 90
      WHEN 'render_failed'        THEN 95
    END`),
    ts: timestamp({ withTimezone: true }).notNull(), // čas události u providera
    // PARTIČNÍ KLÍČ. Vždy now(), tedy monotónní a vždy uvnitř existujícího okna.
    // Partitionovat podle ts by znamenalo, že zpožděný bounce s časovou značkou
    // mimo okno TVRDĚ SELŽE a událost o doručení se ztratí.
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    source: text().notNull(),
    metadata: jsonb().notNull().default({}),
  },
  (t) => [primaryKey({ name: 'pk_message_events', columns: [t.id, t.receivedAt] })],
);

export const providerEventReceipts = pgTable(
  'provider_event_receipts',
  {
    id: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    workspaceId: uuid().notNull(),
    providerId: uuid().notNull(),
    dedupKey: text().notNull(),
    snsMessageId: text(),
    eventType: text().notNull(),
    messageId: uuid(),
    messageCreatedAt: timestamp({ withTimezone: true }),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    status: text().notNull().default('received'),
    raw: jsonb().notNull(),
  },
  (t) => [primaryKey({ name: 'pk_provider_event_receipts', columns: [t.id, t.receivedAt] })],
);

export const inboundDeliveries = pgTable(
  'inbound_deliveries',
  {
    id: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    workspaceId: uuid().notNull(),
    endpointId: uuid().notNull(),
    externalId: text(),
    status: text().notNull(),
    errorCode: text(),
    errorDetail: text(),
    contactId: uuid(),
    action: text(), // subscribe | unsubscribe | update | ignore
    payload: jsonb().notNull(),
    headers: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ name: 'pk_inbound_deliveries', columns: [t.id, t.createdAt] })],
);

export const webEvents = pgTable(
  'web_events',
  {
    // DEFAULT schválně NENÍ: ID generuje klient a server ho jen přebírá.
    // Default by zamaskoval chybu, kdy klient ID neposlal.
    id: uuid().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    workspaceId: uuid().notNull(),
    name: text().notNull(),
    anonymousId: uuid(),
    contactId: uuid(),
    sessionId: uuid(),
    source: text().notNull().default('web'),
    page: jsonb().notNull().default({}),
    properties: jsonb().notNull().default({}),
    context: jsonb().notNull().default({}),
    identityMergeId: uuid(),
    erasedAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ name: 'pk_web_events', columns: [t.id, t.receivedAt] })],
);

export const messageEngagement = pgTable(
  'message_engagement',
  {
    messageId: uuid().notNull(),
    // Kopie messages.created_at. Řádek engagementu tak leží ve stejném měsíčním
    // okně jako zpráva, retence obou se odpojuje společně a dotaz, který zná
    // zprávu, zná i partition.
    createdAt: timestamp({ withTimezone: true }).notNull(),
    workspaceId: uuid().notNull(),
    campaignId: uuid().notNull(),
    contactId: uuid(),
    erasedAt: timestamp({ withTimezone: true }),

    firstOpenAt: timestamp({ withTimezone: true }),
    lastOpenAt: timestamp({ withTimezone: true }),
    openCount: integer().notNull().default(0),
    firstHumanOpenAt: timestamp({ withTimezone: true }),
    humanOpenCount: integer().notNull().default(0),
    // Bity: 1 = human, 2 = proxy_apple, 4 = proxy_image, 8 = bot, 16 = unknown.
    openClassMask: integer().notNull().default(0),

    firstClickAt: timestamp({ withTimezone: true }),
    lastClickAt: timestamp({ withTimezone: true }),
    clickCount: integer().notNull().default(0),
    firstHumanClickAt: timestamp({ withTimezone: true }),
    humanClickCount: integer().notNull().default(0),
    clickedLinks: integer().notNull().default(0),
  },
  (t) => [primaryKey({ name: 'pk_message_engagement', columns: [t.messageId, t.createdAt] })],
);

export type AuditLog = typeof auditLog.$inferSelect;
export type AuditLogInsert = typeof auditLog.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type WebhookEventInsert = typeof webhookEvents.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type WebhookDeliveryInsert = typeof webhookDeliveries.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
export type MessageEvent = typeof messageEvents.$inferSelect;
export type MessageEventInsert = typeof messageEvents.$inferInsert;
export type ProviderEventReceipt = typeof providerEventReceipts.$inferSelect;
export type ProviderEventReceiptInsert = typeof providerEventReceipts.$inferInsert;
export type InboundDelivery = typeof inboundDeliveries.$inferSelect;
export type InboundDeliveryInsert = typeof inboundDeliveries.$inferInsert;
export type WebEvent = typeof webEvents.$inferSelect;
export type WebEventInsert = typeof webEvents.$inferInsert;
export type MessageEngagement = typeof messageEngagement.$inferSelect;
export type MessageEngagementInsert = typeof messageEngagement.$inferInsert;
