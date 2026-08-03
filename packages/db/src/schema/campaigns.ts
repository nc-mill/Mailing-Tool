// packages/db/src/schema/campaigns.ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users, workspaces } from './identity';
import { lists } from './contacts';
import { templates } from './content';

export const sendingProviders = pgTable(
  'sending_providers',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    // Uzavřený výčet schválně, ale ne navždy: MVP 2 slibuje pluginové providery
    // a rozšíření je jednořádková migrace. Aplikační kód s vyčerpaností výčtu
    // počítat nesmí.
    type: text().$type<'ses' | 'smtp'>().notNull(),
    // enc:v1:<base64>, context 'sending_provider', workspace_id v AAD.
    // Šifrovaný obsah je KOMPLETNÍ konfigurace, ne jen tajemství: sender by ji
    // jinak skládal ze dvou zdrojů a hrozilo by, že se rozejdou.
    configEncrypted: text().notNull(),
    configPublic: jsonb().notNull().default({}), // odvozená necitlivá kopie pro UI
    isDefault: boolean().notNull().default(false),
    status: text().notNull().default('unverified'),
    statusDetail: jsonb(),
    verifiedAt: timestamp({ withTimezone: true }),
    // Zrcadlo stavu účtu, plní job provider.refresh_quota. Pro SES je
    // quota_max_send_rate ZÁVAZNÝM zdrojem rychlosti, obálku sender použije,
    // jen když je sloupec NULL. Kvůli tomu, aby se rate měnil bez přešifrovávání.
    quotaMax24h: integer(),
    quotaMaxSendRate: numeric({ precision: 10, scale: 2 }),
    quotaSent24h: integer(),
    productionAccess: boolean(),
    enforcementStatus: text(), // HEALTHY | PROBATION | SHUTDOWN
    sendingEnabled: boolean(),
    quotaCheckedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_sending_providers__type', sql`${t.type} IN ('ses','smtp')`),
    check(
      'ck_sending_providers__status',
      sql`${t.status} IN
    ('unverified','verifying','ready','degraded','blocked','disabled')`,
    ),
    // Právě jeden výchozí provider na projekt. Částečný unikátní index je levnější
    // než trigger a na rozdíl od aplikační kontroly nejde obejít souběhem.
    uniqueIndex('uq_sending_providers__one_default')
      .on(t.workspaceId)
      .where(sql`${t.isDefault}`),
    index('idx_sending_providers__workspace').on(t.workspaceId, t.createdAt.desc()),
    index('idx_sending_providers__quota_stale')
      .on(t.quotaCheckedAt.nullsFirst())
      .where(sql`${t.status} IN ('ready','degraded')`),
  ],
);

export const senderDomains = pgTable(
  'sender_domains',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    providerId: uuid()
      .notNull()
      .references(() => sendingProviders.id, { onDelete: 'cascade' }),
    domain: text().notNull(), // lowercase, bez trailing tečky, bez "www."
    dkimTokens: text().array().notNull().default([]),
    dkimHostedZone: text(),
    dkimKeyLength: text().notNull().default('RSA_2048_BIT'),
    dkimStatus: text().notNull().default('not_started'),
    mailFromSubdomain: text(),
    mailFromStatus: text().notNull().default('not_configured'),
    spfOk: boolean(),
    dkimOk: boolean(),
    dmarcOk: boolean(),
    mxOk: boolean(),
    checks: jsonb().notNull().default({}),
    checkedAt: timestamp({ withTimezone: true }),
    nextCheckAt: timestamp({ withTimezone: true }),
    sesVerificationStatus: text(),
    verifiedAt: timestamp({ withTimezone: true }),
    // Delegace nastavení DNS na někoho, kdo do nástroje přístup nemá (část 6,
    // bod 8.2.5). Ukládá se HASH tokenu, nikdy token sám: odkaz se posílá
    // e-mailem a v databázi po něm nesmí zůstat použitelná kopie.
    delegationTokenHash: text(),
    delegationExpiresAt: timestamp({ withTimezone: true }),
    delegationCreatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ck_sender_domains__dkim_status',
      sql`${t.dkimStatus} IN
    ('not_started','pending','success','failed','temporary_failure')`,
    ),
    // Hash a jeho platnost drží nebo padají spolu. Token bez konce platnosti
    // by byl trvalý přístupový odkaz do nastavení domény. Ověřeno spuštěním.
    check(
      'ck_sender_domains__delegation',
      sql`
    (${t.delegationTokenHash} IS NULL AND ${t.delegationExpiresAt} IS NULL) OR
    (${t.delegationTokenHash} IS NOT NULL AND ${t.delegationExpiresAt} IS NOT NULL)`,
    ),
    check(
      'ck_sender_domains__mail_from_status',
      sql`${t.mailFromStatus} IN
    ('not_configured','pending','success','failed')`,
    ),
    uniqueIndex('uq_sender_domains__workspace_domain').on(t.workspaceId, sql`lower(${t.domain})`),
    index('idx_sender_domains__next_check')
      .on(t.nextCheckAt)
      .where(sql`${t.nextCheckAt} IS NOT NULL`),
    // Ověření delegačního odkazu: jediný lookup podle hashe. Index je ČÁSTEČNÝ,
    // jinak by unikátnost platila i pro NULL a druhá doména bez delegace by
    // se nedala založit. Ověřeno spuštěním: dva řádky bez tokenu projdou,
    // dva se stejným tokenem skončí chybou 23505.
    uniqueIndex('uq_sender_domains__delegation_token')
      .on(t.delegationTokenHash)
      .where(sql`${t.delegationTokenHash} IS NOT NULL`),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /**
     * `'campaign'` je kampaň, kterou založil uživatel. `'system'` je skrytá
     * kampaň, kterou si vyrobila aplikace, aby měla kam zavěsit testovací
     * odeslání šablony (migrace 0010).
     *
     * Systémová kampaň se NESMÍ objevit v seznamu kampaní, v postupu
     * onboardingu, v dopadové analýze polí ani v reportech. Filtruje se
     * sloupcem, ne jménem: filtr podle jména by musel být v každém dotazu
     * a stačí ho v jednom vynechat. Týž vzor jako `messages.kind`.
     */
    kind: text().$type<'campaign' | 'system'>().notNull().default('campaign'),
    status: text().notNull().default('draft'),
    subject: text().notNull().default(''),
    preheader: text().notNull().default(''),
    fromName: text().notNull().default(''),
    fromEmail: text().notNull().default(''), // normalizováno na lowercase při zápisu
    replyTo: text(),
    templateId: uuid().references(() => templates.id, { onDelete: 'set null' }),
    design: jsonb(),
    compiledHtml: text(),
    compiledText: text(),
    compiledAt: timestamp({ withTimezone: true }),
    compiledFields: text().array().notNull().default([]),
    compiledHash: text(),
    audience: jsonb()
      .notNull()
      .default({ include: { lists: [], segments: [] }, exclude: { lists: [], segments: [] } }),
    audienceSize: integer(),
    // Rozpad publika na složky (kolik z kterého seznamu a segmentu, kolik ubral
    // který filtr). Kontrolní seznam před odesláním, potvrzovací dialog i report
    // mají ukazovat TOTOŽNÉ číslo z jednoho zdroje; bez uloženého rozpadu si ho
    // každá ze tří cest počítá znovu a v okamžiku, kdy se publikum mezitím
    // změní, ukáže každá jiné. Zmrazuje se spolu s audience_built_at.
    audienceBreakdown: jsonb(),
    // Okamžik zmrazení publika. Je zároveň created_at VŠECH zpráv kampaně,
    // viz invariant I1. Ukládá se zaokrouhlené na celé sekundy.
    audienceBuiltAt: timestamp({ withTimezone: true }),
    providerId: uuid().references(() => sendingProviders.id, { onDelete: 'restrict' }),
    senderDomainId: uuid().references(() => senderDomains.id, { onDelete: 'restrict' }),
    trackOpens: boolean().notNull().default(true),
    trackClicks: boolean().notNull().default(true),
    unsubscribeListId: uuid().references(() => lists.id, { onDelete: 'set null' }),
    revision: integer().notNull().default(1), // klíč cache senderu
    /**
     * Metadata z kompilace šablony. Sender z nich čte `clickMarkerCount`
     * a porovnává ho s počtem značek, které v těle skutečně našel (kontrola V4).
     *
     * Sloupec tu dřív nebyl a sender si tu kontrolu SÁM VYPÍNAL, jen s řádkem
     * v logu: `compile_meta_column_missing, kontrola počtu značek se vypíná`.
     * Nic nespadlo, jen se tiše ztratila ochrana proti rozbité kompilaci.
     * Ta shovívavost v senderu zůstává, protože musí umět běžet i proti starší
     * databázi, ale ve schématu ten sloupec od téhle migrace je.
     */
    compileMeta: jsonb(),
    releaseAt: timestamp({ withTimezone: true }), // undo okno
    scheduledAt: timestamp({ withTimezone: true }),
    scheduleTimezone: text(), // IANA, např. 'Europe/Prague'
    totalCount: integer().notNull().default(0),
    sentCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    skippedCount: integer().notNull().default(0),
    bounceCount: integer().notNull().default(0),
    complaintCount: integer().notNull().default(0),
    deliveredCount: integer().notNull().default(0),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    pausedAt: timestamp({ withTimezone: true }),
    // KONTRAKTNÍ SLOUPEC (část 1, 4.10.1). Typ je jsonb, ne text, protože do něj
    // zapisuje i sender a potřebuje vedle kódu předat zdroj, čas a svoje ID.
    // Sender na něj má sloupcový GRANT UPDATE (status, pause_reason).
    pauseReason: jsonb(),
    cancelReason: text(),
    lastError: jsonb(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('ck_campaigns__kind', sql`${t.kind} IN ('campaign','system')`),
    check(
      'ck_campaigns__status',
      sql`${t.status} IN (
    'draft','scheduled','queueing','sending','paused',
    'sent','partially_sent','cancelled','failed','schedule_missed')`,
    ),
    check(
      'ck_campaigns__schedule',
      sql`(${t.status} <> 'scheduled') OR
    (${t.scheduledAt} IS NOT NULL AND ${t.scheduleTimezone} IS NOT NULL)`,
    ),
    index('idx_campaigns__workspace_status')
      .on(t.workspaceId, t.status, t.updatedAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    // Plánovač hledá jen kampaně čekající na svůj čas. Částečný index drží
    // skenování v jednotkách řádků.
    index('idx_campaigns__scheduler')
      .on(t.scheduledAt)
      .where(sql`${t.status} = 'scheduled' AND ${t.deletedAt} IS NULL`),
    index('idx_campaigns__running')
      .on(t.workspaceId)
      .where(sql`${t.status} IN ('queueing','sending') AND ${t.deletedAt} IS NULL`),
    // Dohledání skryté kampaně šablony. Bez částečného indexu by to byl sken
    // všech kampaní projektu.
    index('idx_campaigns__system_template')
      .on(t.workspaceId, t.templateId)
      .where(sql`${t.kind} = 'system' AND ${t.deletedAt} IS NULL`),
  ],
);

/** MVP 1. V MVP 0 zůstává prázdná, UI ji nepoužívá. Je tu proto, že přidat
 *  prázdný sloupec dnes stojí jeden ALTER TABLE bez přepisu dat, kdežto za rok
 *  do tabulky s desítkami milionů řádků je to něco jiného. */
export const campaignContentVariants = pgTable(
  'campaign_content_variants',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    label: text().notNull(), // 'A', 'B', ... pro report
    weight: smallint().notNull().default(1), // poměr rozdělení publika
    // Přepisy obsahu. NULL znamená "ber hodnotu ze sloupce kampaně".
    subject: text(),
    preheader: text(),
    fromName: text(),
    design: jsonb(),
    compiledHtml: text(),
    compiledText: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // workspace_id v čele: campaignId projekt jednoznačně určuje, unikátnost
    // se nemění, ale kaskáda z workspaces a RLS dostanou index.
    uniqueIndex('uq_campaign_content_variants__ws_campaign_label').on(
      t.workspaceId,
      t.campaignId,
      t.label,
    ),
  ],
);

export const campaignLinks = pgTable(
  'campaign_links',
  {
    // BEZ .default(): id je UUIDv5 odvozené z kampaně a URL, aby proklik přežil
    // rekompilaci kampaně (rozhodnutí R40). S výchozí hodnotou by první cesta,
    // která řádek vloží bez id, dostala náhodné UUID, odkaz v už odeslaném
    // e-mailu by na něj nenavázal a report odkazů by zůstal PRÁZDNÝ, aniž by
    // cokoli spadlo. Bez DEFAULT skončí takový zápis chybou not-null, tedy
    // hlasitě a v testu. Ověřeno spuštěním.
    id: uuid().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    url: text().notNull(), // původní URL, může obsahovat Liquid
    position: integer().notNull(), // pořadí výskytu v HTML, od 0
    label: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Horká cesta prokliku jde přes primární klíč id a ta se nemění. Tenhle
    // index slouží kompilaci šablony, reportu odkazů a kaskádě z workspaces.
    uniqueIndex('uq_campaign_links__ws_campaign_position').on(
      t.workspaceId,
      t.campaignId,
      t.position,
    ),
  ],
);

/** Denní zrcadlo doručitelnosti. Bez něj by dashboard počítal agregace
 *  přes message_events při každém načtení. */
export const deliverabilitySnapshots = pgTable(
  'deliverability_snapshots',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    providerId: uuid()
      .notNull()
      .references(() => sendingProviders.id, { onDelete: 'cascade' }),
    day: date().notNull(),
    sent: integer().notNull().default(0),
    delivered: integer().notNull().default(0),
    hardBounces: integer().notNull().default(0),
    softBounces: integer().notNull().default(0),
    complaints: integer().notNull().default(0),
    rejects: integer().notNull().default(0),
    deliveryDelays: integer().notNull().default(0),
    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'pk_deliverability_snapshots',
      columns: [t.workspaceId, t.providerId, t.day],
    }),
  ],
);

/** Stav materializace, aby šla po restartu workeru bezpečně dokončit. */
export const campaignAudienceProgress = pgTable(
  'campaign_audience_progress',
  {
    campaignId: uuid()
      .primaryKey()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    phase: text().notNull().default('collecting'),
    cursorContactId: uuid(), // kurzor přes ORDER BY id
    insertedRows: integer().notNull().default(0),
    skippedSuppressed: integer().notNull().default(0),
    skippedUnsubscribed: integer().notNull().default(0),
    skippedInvalid: integer().notNull().default(0),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      'ck_campaign_audience_progress__phase',
      sql`${t.phase} IN ('collecting','materializing','done')`,
    ),
    // Obnova po restartu workeru: "co je v tomhle projektu rozpracované".
    // Zároveň jediný index použitelný pro kaskádu z workspaces.
    index('idx_campaign_audience_progress__ws_updated').on(t.workspaceId, t.updatedAt.desc()),
  ],
);

/**
 * Agregovaná varování z renderu. Vlastní část 4a, zapisuje sender, čte report.
 * NEPATŘÍ do message_events: kampaň na 50 000 příjemců, kde šablona sahá na pole,
 * které polovina kontaktů nemá, by tam vyrobila 25 000 řádků s toutéž informací
 * a zdvojnásobila objem tabulky. Navíc by se kvůli tomu musely message_id
 * a message_created_at uvolnit na NULL pro všechny typy a přestala by platit
 * jediná záruka, na které stojí levné dohledání zprávy.
 */
export const campaignRenderWarnings = pgTable(
  'campaign_render_warnings',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    code: text().notNull(), // 'missing_value', ...
    path: text().notNull(), // 'contact.attributes.city'
    count: bigint({ mode: 'number' }).notNull().default(0),
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sample: jsonb().notNull().default([]),
  },
  (t) => [
    primaryKey({
      name: 'pk_campaign_render_warnings',
      columns: [t.workspaceId, t.campaignId, t.code, t.path],
    }),
  ],
);

export type SendingProvider = typeof sendingProviders.$inferSelect;
export type SendingProviderInsert = typeof sendingProviders.$inferInsert;
export type SenderDomain = typeof senderDomains.$inferSelect;
export type SenderDomainInsert = typeof senderDomains.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignInsert = typeof campaigns.$inferInsert;
export type CampaignContentVariant = typeof campaignContentVariants.$inferSelect;
export type CampaignContentVariantInsert = typeof campaignContentVariants.$inferInsert;
export type CampaignLink = typeof campaignLinks.$inferSelect;
export type CampaignLinkInsert = typeof campaignLinks.$inferInsert;
export type DeliverabilitySnapshot = typeof deliverabilitySnapshots.$inferSelect;
export type DeliverabilitySnapshotInsert = typeof deliverabilitySnapshots.$inferInsert;
export type CampaignAudienceProgress = typeof campaignAudienceProgress.$inferSelect;
export type CampaignAudienceProgressInsert = typeof campaignAudienceProgress.$inferInsert;
export type CampaignRenderWarning = typeof campaignRenderWarnings.$inferSelect;
export type CampaignRenderWarningInsert = typeof campaignRenderWarnings.$inferInsert;
