// packages/db/src/schema/contacts.ts
import { sql } from 'drizzle-orm';
import {
  bigint,
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bytea, byteaArray, citext, inet, inetArray } from './_types';
import { workspaces } from './identity';

export const contacts = pgTable(
  'contacts',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    email: citext().notNull(),
    // Otisky adresy pro VŠECHNA známá pokolení klíče. Recept vlastní část 1 (3.10):
    // HMAC-SHA256(HKDF(SECRET_KEY, "mailer/v1", "mailer/v1/suppression-fingerprint"), lower(email)).
    emailFingerprints: byteaArray()
      .notNull()
      .default(sql`'{}'::bytea[]`),
    emailDomain: text().generatedAlwaysAs(sql`lower(split_part(email::text, '@', 2))`),

    status: text()
      .$type<'active' | 'unconfirmed' | 'unsubscribed' | 'bounced' | 'complained' | 'deleted'>()
      .notNull()
      .default('active'),
    processingRestricted: boolean().notNull().default(false), // GDPR čl. 18

    firstName: text(),
    lastName: text(),
    middleName: text(),
    titlePrefix: text(),
    titleSuffix: text(),

    // lower + NFD + odstraněné kombinovací znaky, plní aplikace normalizeNameKey().
    firstNameKey: text(),
    lastNameKey: text(),

    // Vyhledávací klíč BEZ DIAKRITIKY přes celý kontakt (e-mail, jméno, příjmení),
    // plní ho aplikace týmž normalizeNameKey() jako klíče výš. Nesmí to být
    // generovaný sloupec: odstranění diakritiky umí jen unaccent(), a to je
    // funkce STABLE, ne IMMUTABLE, takže ji generovaný sloupec ani indexový
    // výraz použít nemůže. Rozšíření unaccent je navíc zamítnuté.
    //
    // Proč vedle search_text: search_text drží text v původním tvaru, takže
    // "Novacek" v něm "Nováčka" nenajde. Hledání bez diakritiky musí fungovat
    // OBOUSMĚRNĚ, tedy i dotaz s diakritikou nad odstraněnou a naopak, a to jde
    // jen tak, že se obě strany normalizují stejně. Je to požadavek P07 (R12).
    searchKey: text(),

    gender: text().$type<'female' | 'male' | 'unknown'>().notNull().default('unknown'),
    genderSource: text().notNull().default('none'),

    firstNameVocative: text(),
    lastNameVocative: text(),
    vocativeConfidence: text().$type<'high' | 'low' | 'none'>().notNull().default('none'),
    vocativeLocked: boolean().notNull().default(false),
    vocativeLockedFor: text(),
    vocativeReviewedAt: timestamp({ withTimezone: true }),
    vocativeReviewedBy: uuid(),

    greeting: text().notNull().default(''),
    greetingNeutral: text().notNull().default(''),
    nameSplitConfidence: text().$type<'high' | 'low' | 'none'>().notNull().default('none'),

    attributes: jsonb().notNull().default({}),
    locale: text().notNull().default('cs'),
    timezone: text(),

    source: text().notNull().default('manual'),
    sourceRef: text(),

    // Rozhodnutí R6: požadavek části 5 (12.3, bod 4). Nepodepsané identify
    // z prohlížeče páruje kontakt podle vlastního identifikátoru zákazníka.
    externalId: text(),

    lastActivityAt: timestamp({ withTimezone: true }), // udržuje část 5
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    anonymizedAt: timestamp({ withTimezone: true }),

    searchText: text().generatedAlwaysAs(sql`lower(
    coalesce(email::text,'') || ' ' || coalesce(first_name,'') || ' ' || coalesce(last_name,''))`),
  },
  (t) => [
    check(
      'ck_contacts__status',
      sql`${t.status} IN
    ('active','unconfirmed','unsubscribed','bounced','complained','deleted')`,
    ),
    check('ck_contacts__gender', sql`${t.gender} IN ('female','male','unknown')`),
    check(
      'ck_contacts__gender_source',
      sql`${t.genderSource} IN
    ('explicit','workspace_override','surname_rule','surname_rule_translit',
     'given_name_dict','library_heuristic','manual','none')`,
    ),
    check(
      'ck_contacts__vocative_confidence',
      sql`${t.vocativeConfidence} IN ('high','low','none')`,
    ),
    check(
      'ck_contacts__name_split_confidence',
      sql`${t.nameSplitConfidence} IN ('high','low','none')`,
    ),
    check(
      'ck_contacts__source',
      sql`${t.source} IN
    ('manual','import','api','form','webhook','double_opt_in','migration')`,
    ),
    // Tvarová pojistka, ne seznam povolených jazyků. Import z cizího CRM běžně nese
    // fr-CA nebo zh-Hant a shodit kvůli tomu řádek je nepřiměřené.
    check(
      'ck_contacts__locale',
      sql`${t.locale} ~ '^[a-zA-Z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$'`,
    ),
    check('ck_contacts__email_len', sql`char_length(${t.email}::text) BETWEEN 3 AND 254`),
    check('ck_contacts__attributes_object', sql`jsonb_typeof(${t.attributes}) = 'object'`),
    // Pojistka proti havárii, ne vynucení limitu. Skutečný limit hlídá aplikace nad
    // SERIALIZOVANOU délkou JSON, protože pg_column_size měří velikost po TOAST
    // kompresi a dva kontakty se stejně dlouhými daty by skončily jeden pod limitem
    // a druhý nad ním podle toho, jak dobře se text komprimuje.
    check('ck_contacts__attributes_sane', sql`pg_column_size(${t.attributes}) <= 4194304`),

    // 1. Klíč pro upsert. Částečný: měkce smazaný kontakt nesmí blokovat nové přihlášení.
    uniqueIndex('uq_contacts__workspace_email')
      .on(t.workspaceId, t.email)
      .where(sql`${t.deletedAt} IS NULL`),
    // 2. Výchozí řazení v seznamu a kurzorové stránkování (keyset na (created_at, id)).
    index('idx_contacts__ws_created')
      .on(t.workspaceId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    // 3. Filtr podle stavu v seznamu i v segmentech.
    index('idx_contacts__ws_status_created')
      .on(t.workspaceId, t.status, t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    // 4. Preset "neaktivní 90+ dní" a řazení podle poslední aktivity.
    index('idx_contacts__ws_last_activity')
      .on(t.workspaceId, t.lastActivityAt.desc().nullsLast())
      .where(sql`${t.deletedAt} IS NULL`),
    // 5. Fulltext v UI. btree_gin dovolí uuid do stejného indexu jako trigramy,
    //    takže dotaz nikdy neprochází cizí projekty.
    index('idx_contacts__search_trgm').using(
      'gin',
      t.workspaceId,
      sql`${t.searchText} gin_trgm_ops`,
    ),
    // 5b. Totéž nad klíčem bez diakritiky. Ověřeno spuštěním: dotaz
    //     `search_key LIKE '%novacek%'` najde kontakt "Nováček" a plánovač
    //     na index skutečně sáhne (Bitmap Index Scan), takže hledání
    //     neprochází cizí projekty ani nedělá seq scan.
    index('idx_contacts__search_key_trgm').using(
      'gin',
      t.workspaceId,
      sql`${t.searchKey} gin_trgm_ops`,
    ),
    // 6. Rovnostní a containment predikáty nad vlastními poli v segmentech.
    //    jsonb_path_ops je menší a rychlejší než výchozí jsonb_ops a stačí na @>.
    index('idx_contacts__attributes_gin').using('gin', sql`${t.attributes} jsonb_path_ops`),
    // 7. Fronta ke kontrole vokativu. Zobrazuje se výhradně seskupená podle
    //    first_name_key, nikdy po jednotlivých kontaktech.
    index('idx_contacts__ws_vocative_review').on(t.workspaceId, t.firstNameKey, t.createdAt.desc())
      .where(sql`${t.vocativeConfidence} = 'low' AND ${t.vocativeLocked} = false
               AND ${t.deletedAt} IS NULL`),
    // 8. Operátor matches_domain v segmentech a analýza doručitelnosti.
    index('idx_contacts__ws_email_domain')
      .on(t.workspaceId, t.emailDomain)
      .where(sql`${t.deletedAt} IS NULL`),
    // 9. Kontrola suppression po výmazu: kontakt nese otisk pod všemi pokoleními klíče.
    index('idx_contacts__email_fingerprints').using('gin', t.emailFingerprints),
    // 10. Kurzorový průchod celým projektem podle id: materializace publika po dávkách,
    //     hromadné mazání, export, přepočty. Bez něj by dotaz sedl na primární klíč
    //     a procházel i cizí projekty, než by je zahodil.
    index('idx_contacts__ws_id')
      .on(t.workspaceId, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    // 11. Rozhodnutí R6: párování podle externího identifikátoru zákazníka.
    uniqueIndex('uq_contacts__ws_external_id')
      .on(t.workspaceId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
);

export const contactFields = pgTable(
  'contact_fields',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    // Otevřená mapa jazyk na text. Sada jazyků je záměrně neomezená, přidání
    // jazyka nesmí vyžadovat migraci ani změnu kódu.
    label: jsonb().notNull().default({}),
    description: jsonb().notNull().default({}),
    type: text().notNull(),
    options: jsonb().notNull().default({}),
    required: boolean().notNull().default(false),
    subjectEditable: boolean().notNull().default(false),
    indexed: boolean().notNull().default(false),
    indexState: text().$type<'none' | 'building' | 'ready' | 'failed'>().notNull().default('none'),
    position: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_contact_fields__key', sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      'ck_contact_fields__type',
      sql`${t.type} IN
    ('text','long_text','number','boolean','date','datetime',
     'enum','multi_enum','url','email','phone')`,
    ),
    check(
      'ck_contact_fields__index_state',
      sql`${t.indexState} IN ('none','building','ready','failed')`,
    ),
    // ÚPLNÝ index schválně: archivované pole je živý záznam a jeho klíč se nesmí
    // dát znovu použít s jiným typem.
    uniqueIndex('uq_contact_fields__workspace_key').on(t.workspaceId, t.key),
    index('idx_contact_fields__ws_position')
      .on(t.workspaceId, t.position)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    color: text(),
    description: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_tags__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check('ck_tags__color', sql`${t.color} IS NULL OR ${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
    // Štítky se zadávají volným textem, kolize na velikosti písmen je nejčastější chyba.
    uniqueIndex('uq_tags__workspace_name').on(t.workspaceId, sql`lower(${t.name})`),
  ],
);

export const contactTags = pgTable(
  'contact_tags',
  {
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    // workspace_id je odvoditelné z kontaktu, ale je tu schválně: kompilátor
    // segmentů díky tomu nemusí joinovat zpět na contacts.
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_contact_tags', columns: [t.contactId, t.tagId] }),
    // Segment "má štítek X" jde od štítku ke kontaktům, proto obrácený index.
    // workspace_id v čele je POVINNÉ u každé tabulky s kaskádou na workspaces:
    // bez něj je tvrdé smazání projektu sekvenční průchod celou tabulkou
    // a politika ws_isolation se nevyhodnocuje nad indexovaným sloupcem.
    index('idx_contact_tags__ws_tag_contact').on(t.workspaceId, t.tagId, t.contactId),
  ],
);

export const lists = pgTable(
  'lists',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    optIn: text().$type<'single' | 'double'>().notNull().default('double'),
    confirmationMode: text().$type<'one_step' | 'two_step'>().notNull().default('two_step'),
    confirmationTtlHours: integer().notNull().default(168),
    /**
     * Šablony tří e-mailů seznamu. `NULL` NENÍ chybějící hodnota: znamená
     * „použije se obecné znění", tedy konstanta typu `Document` v
     * `packages/core/src/contacts/lists/default-emails.ts`. Seedovat obecné
     * znění jako řádek u každého projektu by znamenalo jeho kopii u každého
     * zákazníka a datovou migraci při opravě překlepu.
     *
     * Cizí klíče `fk_lists__*_template` s `ON DELETE SET NULL` jsou JEN
     * v migraci 0017, ne tady, stejně jako u `forms.delivery_template_id`.
     * Zapsat je přes `.references(() => templates.id)` by znamenalo import
     * z `content.ts` do `contacts.ts`, a ten modul importuje kontakty zpátky.
     */
    confirmationTemplateId: uuid(),
    welcomeTemplateId: uuid(),
    goodbyeTemplateId: uuid(),
    sendWelcome: boolean().notNull().default(false),
    /**
     * Poslat po odhlášení rozloučení? Výchozí NE, rozhodnutí zadavatele
     * z 5. 8. 2026: část odesílatelů ho záměrně neposílá, protože e-mail
     * po odhlášení bývá vnímaný jako drzost.
     */
    sendGoodbye: boolean().notNull().default(false),
    /**
     * Kam poslat člověka po potvrzení přihlášení a po odhlášení. `NULL`
     * znamená „zůstane naše stránka", což je pro většinu projektů správně:
     * vlastní stránka musí mít text o tom, co se právě stalo.
     */
    confirmRedirectUrl: text(),
    unsubscribeRedirectUrl: text(),
    /**
     * Co udělá kliknutí na odhlašovací odkaz v e-mailu z TOHOHLE seznamu:
     * odhlásí jen z něj (`list`), nebo ze všeho (`global`)?
     *
     * NENÍ TO JEN ROZSAH. Globální odhlášení zakládá záznam do `suppressions`
     * pro celý projekt (`lists/unsubscribe.ts`), tedy adresu zablokuje napříč
     * všemi seznamy, kdežto odhlášení ze seznamu ne. Výchozí `list` je dnešní
     * chování, viz migrace 0027.
     */
    unsubscribeScope: text().$type<'list' | 'global'>().notNull().default('list'),
    /**
     * Kam poslat člověka, který odešle formulář adresou, která v seznamu už
     * POTVRZENÁ je. `NULL` znamená „chová se to jako dosud", tedy stejná
     * děkovací stránka jako u nového zájemce.
     *
     * VÝCHOZÍ `NULL` JE BEZPEČNOSTNÍ ROZHODNUTÍ, ne opatrnost: jiná odpověď na
     * známou adresu prozradí, kdo v databázi je, a odpověď formuláře je jinak
     * jednotná schválně (`UNIFORM_RESPONSE` ve `forms/submit.ts`, R9).
     */
    alreadySubscribedRedirectUrl: text(),
    /**
     * Šablony VEŘEJNÝCH STRÁNEK seznamu, tedy `templates.kind = 'page'`. Není to
     * e-mail: je to dokument, který nahradí obsah stránky, kterou návštěvník
     * uvidí po potvrzení přihlášení, při opakovaném přihlášení už potvrzenou
     * adresou a po odhlášení.
     *
     * `NULL` znamená VESTAVĚNÝ TEXT, tedy dnešní chování, a je to výchozí stav
     * i po migraci 0029. Nepoužitelnou hodnotou to nikdy nebude: cizí klíče
     * `fk_lists__*_template` mají `ON DELETE SET NULL`, takže smazání šablony
     * seznam vrátí k vestavěnému textu místo toho, aby ho shodilo.
     *
     * Děkovací stránka po odeslání formuláře tu sloupec NEMÁ schválně: vlastní
     * ji formulář (klíč `thanks_template_id` pod `forms.design.pages`) a seznam
     * o ní nemá co rozhodovat. Naopak stránka po odhlášení je jen tady, protože
     * se na ni chodí z odkazu v e-mailu a není podle čeho určit formulář.
     *
     * Pozor na jméno: sloupec `forms.definition` NEEXISTUJE a nikdy neexistoval,
     * `definition` patří tabulce `segments`. Původní plán ho omylem uváděl
     * a odkaz se odtud dostal až sem do komentáře. Odkazy na stránky bydlí
     * v `forms.design` pod vyhrazeným podklíčem `pages`.
     *
     * Cizí klíče jsou stejně jako u `*_template_id` výš JEN v migraci, ne tady:
     * `.references(() => templates.id)` by znamenalo import z `content.ts`,
     * a ten modul importuje kontakty zpátky.
     */
    confirmedTemplateId: uuid(),
    alreadySubscribedTemplateId: uuid(),
    unsubscribedTemplateId: uuid(),
    confirmationMaxResends: smallint().notNull().default(3),
    isDefault: boolean().notNull().default(false),
    /**
     * Nabízí se seznam ve veřejném centru předvoleb k PŘIHLÁŠENÍ?
     *
     * Výchozí hodnota je `false` a je to bezpečnostní rozhodnutí, ne opatrnost.
     * Dokud sloupec neexistoval, mohl se držitel jakéhokoliv odhlašovacího odkazu sám
     * přihlásit do libovolného seznamu projektu, tedy i do takového, který znamená nárok
     * (VIP, zákazníci se slevou). `false` u existujících seznamů je proto jediná možná
     * migrace: nabízet se smí jen to, co správce vědomě nabídnout chtěl.
     *
     * ODHLÁŠENÍ TENHLE PŘÍZNAK NEŘÍDÍ. Odhlásit se jde vždy a ze všeho, je to zákonná
     * povinnost a nesmí jít vypnout.
     */
    publicVisible: boolean().notNull().default(false),
    /**
     * Jméno, které uvidí PŘÍJEMCE. `name` je pracovní poznámka správce („Novinky od
     * 4. srpna 2026") a příjemci neříká nic. Když chybí, ukáže se `name`, protože
     * bezejmenné zaškrtávátko je horší než pracovní název.
     */
    publicName: text(),
    /** Věta pod veřejným názvem: co příjemci v odběru chodí a jak často. */
    publicDescription: text(),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_lists__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check(
      'ck_lists__public_name_len',
      sql`${t.publicName} IS NULL OR char_length(${t.publicName}) BETWEEN 1 AND 120`,
    ),
    check(
      'ck_lists__public_description_len',
      sql`${t.publicDescription} IS NULL OR char_length(${t.publicDescription}) BETWEEN 1 AND 500`,
    ),
    check('ck_lists__opt_in', sql`${t.optIn} IN ('single','double')`),
    check('ck_lists__confirmation_mode', sql`${t.confirmationMode} IN ('one_step','two_step')`),
    check('ck_lists__confirmation_ttl', sql`${t.confirmationTtlHours} BETWEEN 1 AND 720`),
    check('ck_lists__confirmation_max_resends', sql`${t.confirmationMaxResends} BETWEEN 0 AND 10`),
    check(
      'ck_lists__confirm_redirect_url_len',
      sql`${t.confirmRedirectUrl} IS NULL OR char_length(${t.confirmRedirectUrl}) BETWEEN 1 AND 2000`,
    ),
    check(
      'ck_lists__unsubscribe_redirect_url_len',
      sql`${t.unsubscribeRedirectUrl} IS NULL OR char_length(${t.unsubscribeRedirectUrl}) BETWEEN 1 AND 2000`,
    ),
    check('ck_lists__unsubscribe_scope', sql`${t.unsubscribeScope} IN ('list','global')`),
    check(
      'ck_lists__already_subscribed_redirect_url_len',
      sql`${t.alreadySubscribedRedirectUrl} IS NULL OR char_length(${t.alreadySubscribedRedirectUrl}) BETWEEN 1 AND 2000`,
    ),
    uniqueIndex('uq_lists__workspace_name')
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('uq_lists__workspace_default')
      .on(t.workspaceId)
      .where(sql`${t.isDefault} AND ${t.deletedAt} IS NULL`),
  ],
);

export const listSubscriptions = pgTable(
  'list_subscriptions',
  {
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    listId: uuid()
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    status: text()
      .$type<'pending' | 'confirmed' | 'unsubscribed' | 'bounced' | 'complained'>()
      .notNull(),
    source: text().notNull(),
    sourceRef: text(),
    subscribedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp({ withTimezone: true }),
    unsubscribedAt: timestamp({ withTimezone: true }),
    unsubscribeReason: text(),
    unsubscribeCampaignId: uuid(),
    snoozeUntil: timestamp({ withTimezone: true }),
    confirmationSentAt: timestamp({ withTimezone: true }),
    confirmationResends: smallint().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Klíč je (contact_id, list_id) schválně proti opačnému pořadí: detail kontaktu
    // potřebuje všechny jeho seznamy, což je nejčastější přístup z UI.
    primaryKey({ name: 'pk_list_subscriptions', columns: [t.contactId, t.listId] }),
    check(
      'ck_list_subscriptions__status',
      sql`${t.status} IN
    ('pending','confirmed','unsubscribed','bounced','complained')`,
    ),
    check(
      'ck_list_subscriptions__source',
      sql`${t.source} IN
    ('manual','import','api','form','webhook','preference_center','double_opt_in','migration')`,
    ),
    check(
      'ck_list_subscriptions__unsubscribe_reason',
      sql`${t.unsubscribeReason} IS NULL OR
    ${t.unsubscribeReason} IN ('link','one_click','preference_center','api','manual',
                               'complaint','bounce','global','objection','import')`,
    ),
    // Sestavení publika kampaně: "všichni potvrzení na seznamu X". Nejčastější dotaz v systému.
    index('idx_list_subscriptions__list_status').on(t.listId, t.status, t.contactId),
    index('idx_list_subscriptions__pending')
      .on(t.workspaceId, t.confirmationSentAt)
      .where(sql`${t.status} = 'pending'`),
    index('idx_list_subscriptions__snooze')
      .on(t.workspaceId, t.snoozeUntil)
      .where(sql`${t.snoozeUntil} IS NOT NULL`),
  ],
);

export const subscriptionConfirmations = pgTable(
  'subscription_confirmations',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    listId: uuid()
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    tokenHash: bytea().notNull(), // SHA-256, syrový token se neukládá
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    consumedIp: inet(),
    requestIp: inet(),
    requestUserAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_subscription_confirmations__token_hash').on(t.tokenHash),
    index('idx_subscription_confirmations__expiry')
      .on(t.expiresAt)
      .where(sql`${t.consumedAt} IS NULL`),
    // Úplný, ne částečný: slouží i kaskádovému mazání projektu, které predikát
    // částečného indexu nesplňuje.
    index('idx_subscription_confirmations__ws_created').on(t.workspaceId, t.createdAt),
  ],
);

/** Append only. Vynucuje se odebráním práv aplikační roli v migraci 0006, ne pravidly. */
export const consents = pgTable(
  'consents',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    purpose: text().notNull(),
    scopeListId: uuid().references(() => lists.id, { onDelete: 'set null' }), // NULL = celý projekt
    status: text().$type<'granted' | 'withdrawn'>().notNull(),
    legalBasis: text().notNull(),
    source: text().notNull(),
    sourceRef: text(),
    consentText: text(),
    consentTextHash: bytea(),
    evidence: jsonb().notNull().default({}),
    recordedBy: text().notNull().default('system'),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ck_consents__purpose',
      sql`${t.purpose} IN
    ('email_marketing','analytics','personalization','profiling','third_party')`,
    ),
    check('ck_consents__status', sql`${t.status} IN ('granted','withdrawn')`),
    check(
      'ck_consents__legal_basis',
      sql`${t.legalBasis} IN
    ('consent','legitimate_interest','contract','soft_opt_in')`,
    ),
    // Otevřený výčet: rozšíření je čistá migrace omezení a nevyžaduje synchronizaci
    // s ostatními částmi, protože hodnotu nikdo nečte jako řídicí údaj.
    check(
      'ck_consents__source',
      sql`${t.source} IN
    ('form','import','api','double_opt_in','admin','webhook','preference_center',
     'one_click','complaint','objection','reactivation','migration')`,
    ),
    index('idx_consents__contact_purpose').on(t.contactId, t.purpose, t.occurredAt.desc()),
    index('idx_consents__ws_purpose').on(t.workspaceId, t.purpose, t.occurredAt.desc()),
  ],
);

/** Rychlý pohled na aktuální stav souhlasu. Segmentace nesmí procházet append-only log. */
export const contactConsentState = pgTable(
  'contact_consent_state',
  {
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    purpose: text().notNull(),
    status: text().$type<'granted' | 'withdrawn'>().notNull(),
    legalBasis: text().notNull(),
    since: timestamp({ withTimezone: true }).notNull(),
    lastConsentId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_contact_consent_state', columns: [t.contactId, t.purpose] }),
    check('ck_contact_consent_state__status', sql`${t.status} IN ('granted','withdrawn')`),
    index('idx_contact_consent_state__ws_purpose_status').on(
      t.workspaceId,
      t.purpose,
      t.status,
      t.contactId,
    ),
  ],
);

export const suppressions = pgTable(
  'suppressions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext().notNull(), // u reason='gdpr_erasure' placeholder
    // Otisk původní adresy. Přepočítat ho po rotaci NELZE, protože plaintext je
    // po výmazu pryč. Proto se ověřuje svým pokolením a proto se SECRET_KEY_PREVIOUS
    // nikdy nevyprazdňuje.
    fingerprint: bytea().notNull(),
    fingerprintKeyId: smallint().notNull(),
    reason: text().notNull(),
    source: text().notNull(),
    sourceRef: text(),
    detail: text(),
    metadata: jsonb().notNull().default({}),
    removable: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: text().notNull().default('system'),
    removedAt: timestamp({ withTimezone: true }),
    removedBy: uuid(),
    removalNote: text(),
  },
  (t) => [
    check(
      'ck_suppressions__reason',
      sql`${t.reason} IN
    ('hard_bounce','soft_bounce_threshold','complaint','manual','global_unsubscribe',
     'one_click_unsubscribe','invalid','import','gdpr_erasure','ses_suppressed')`,
    ),
    // Kontrola "smí se na tuhle adresu poslat" musí být O(1), běží při každém
    // přihlášení, importovaném řádku i materializaci publika.
    uniqueIndex('uq_suppressions__workspace_email')
      .on(t.workspaceId, t.email)
      .where(sql`${t.removedAt} IS NULL`),
    // Druhá větev téže kontroly pro adresy vymazané podle GDPR, kde plaintext nemáme.
    index('idx_suppressions__ws_fingerprint')
      .on(t.workspaceId, t.fingerprint)
      .where(sql`${t.removedAt} IS NULL`),
    // mlain doctor čte SELECT DISTINCT fingerprint_key_id a chybějící pokolení
    // hlásí jako KRITICKOU chybu: bez starých klíčů přestanou platit otisky
    // smazaných adres a vymazaný člověk se vrátí prvním importem.
    index('idx_suppressions__fingerprint_key_id').on(t.fingerprintKeyId),
    index('idx_suppressions__ws_reason').on(t.workspaceId, t.reason, t.createdAt.desc()),
  ],
);

export const imports = pgTable(
  'imports',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    filename: text().notNull(),
    // NULL znamená "soubor už v úložišti není". NOT NULL by retenčnímu jobu nedal
    // jak stav zaznamenat a job by donekonečna nabízel ke smazání soubory,
    // které už smazal.
    storageKey: text(),
    byteSize: bigint({ mode: 'number' }).notNull(),
    contentSha256: bytea().notNull(),
    idempotencyKey: text().notNull(),
    status: text().notNull(),
    encoding: text(),
    encodingSource: text(),
    delimiter: text(),
    quoteChar: text().notNull().default('"'),
    hasHeader: boolean().notNull().default(true),
    mapping: jsonb().notNull().default({}),
    options: jsonb().notNull().default({}),
    totalRows: bigint({ mode: 'number' }),
    checkpointRow: bigint({ mode: 'number' }).notNull().default(0),
    checkpointByte: bigint({ mode: 'number' }).notNull().default(0),
    processedRows: bigint({ mode: 'number' }).notNull().default(0),
    createdRows: bigint({ mode: 'number' }).notNull().default(0),
    updatedRows: bigint({ mode: 'number' }).notNull().default(0),
    skippedRows: bigint({ mode: 'number' }).notNull().default(0),
    suppressedRows: bigint({ mode: 'number' }).notNull().default(0),
    errorRows: bigint({ mode: 'number' }).notNull().default(0),
    warningRows: bigint({ mode: 'number' }).notNull().default(0),
    reviewRows: bigint({ mode: 'number' }).notNull().default(0),
    // Kolik chybných řádků je SKUTEČNĚ uložených v import_errors. Liší se od
    // error_rows, protože ukládání chyb má strop: u souboru, kde je špatně
    // všechno, se neukládá milion řádků. Bez tohohle sloupce by se počet
    // uložených musel zjišťovat přes count(*) nad import_errors v KAŽDÉ
    // checkpointové dávce, tedy nejčastějším dotazem celého importu.
    storedErrorCount: bigint({ mode: 'number' }).notNull().default(0),
    // Pokračování zrušeného nebo spadlého importu novým během (kritérium 35
    // části 6). ON DELETE SET NULL, ne cascade: smazání starého záznamu
    // nesmí vzít s sebou import, který na něj jen navazuje.
    resumeFromImportId: uuid().references((): AnyPgColumn => imports.id, { onDelete: 'set null' }),
    errorSummary: jsonb().notNull().default({}),
    failureCode: text(),
    failureDetail: text(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Zapisuje se v KAŽDÉ checkpointové transakci importu. Je to jediný signál
    // živosti, ze kterého obnova po pádu pozná zaseknutý import. Bez něj by
    // zabitý worker import zablokoval navždy.
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    fileExpiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    check('ck_imports__byte_size', sql`${t.byteSize} > 0`),
    check('ck_imports__stored_error_count', sql`${t.storedErrorCount} >= 0`),
    // Import nesmí navazovat sám na sebe. Bez tohohle omezení by obnova
    // uvázla v nekonečné smyčce nad jediným řádkem a vypadalo by to
    // jako zaseknutý worker. Ověřeno spuštěním.
    check('ck_imports__resume_not_self', sql`${t.resumeFromImportId} IS DISTINCT FROM ${t.id}`),
    check(
      'ck_imports__status',
      sql`${t.status} IN
    ('pending','validating','previewing','importing','completed',
     'completed_with_errors','failed','cancelled')`,
    ),
    check(
      'ck_imports__encoding_source',
      sql`${t.encodingSource} IS NULL OR
    ${t.encodingSource} IN ('bom','utf8_validation','score','manual')`,
    ),
    check(
      'ck_imports__delimiter',
      sql`${t.delimiter} IS NULL OR
    ${t.delimiter} IN (';', ',', E'\\t', '|')`,
    ),
    uniqueIndex('uq_imports__workspace_idempotency').on(t.workspaceId, t.idempotencyKey),
    index('idx_imports__ws_created').on(t.workspaceId, t.createdAt.desc()),
    index('idx_imports__file_expiry')
      .on(t.fileExpiresAt)
      .where(sql`${t.storageKey} IS NOT NULL`),
    index('idx_imports__stale')
      .on(t.updatedAt)
      .where(sql`${t.status} = 'importing'`),
  ],
);

export const importErrors = pgTable(
  'import_errors',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    rowNumber: bigint({ mode: 'number' }).notNull(),
    severity: text().$type<'error' | 'warning'>().notNull(),
    columnName: text(),
    errorCode: text().notNull(),
    errorDetail: text(),
    rawLine: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_import_errors__severity', sql`${t.severity} IN ('error','warning')`),
    index('idx_import_errors__ws_import_row').on(t.workspaceId, t.importId, t.rowNumber),
  ],
);

export const exports = pgTable(
  'exports',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    filter: jsonb().notNull().default({}),
    columns: jsonb().notNull().default([]),
    format: text().$type<'csv' | 'ndjson'>().notNull().default('csv'),
    encoding: text().notNull().default('utf-8-bom'),
    delimiter: text().notNull().default(';'),
    status: text().notNull(),
    rowCount: bigint({ mode: 'number' }),
    storageKey: text(),
    byteSize: bigint({ mode: 'number' }),
    downloadTokenHash: bytea(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    failureCode: text(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      'ck_exports__kind',
      sql`${t.kind} IN
    ('contacts','suppressions','import_errors','gdpr_subject')`,
    ),
    check('ck_exports__format', sql`${t.format} IN ('csv','ndjson')`),
    check('ck_exports__encoding', sql`${t.encoding} IN ('utf-8-bom','utf-8','windows-1250')`),
    check(
      'ck_exports__status',
      sql`${t.status} IN
    ('queued','running','completed','failed','expired')`,
    ),
    index('idx_exports__ws_created').on(t.workspaceId, t.createdAt.desc()),
    uniqueIndex('uq_exports__download_token')
      .on(t.downloadTokenHash)
      .where(sql`${t.downloadTokenHash} IS NOT NULL`),
    index('idx_exports__expiry')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'completed'`),
  ],
);

/**
 * Jediný mechanismus, kterým se fronta ke kontrole vokativu časem vyprázdní
 * místo toho, aby při každém importu narostla znovu.
 */
export const nameOverrides = pgTable(
  'name_overrides',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text().$type<'first' | 'last'>().notNull(),
    nameKey: text().notNull(), // lower + NFD + odstraněné diakritické znaky
    gender: text().$type<'female' | 'male' | 'unknown'>(),
    vocative: text(),
    note: text(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_name_overrides__kind', sql`${t.kind} IN ('first','last')`),
    check(
      'ck_name_overrides__gender',
      sql`${t.gender} IS NULL OR
    ${t.gender} IN ('female','male','unknown')`,
    ),
    check(
      'ck_name_overrides__has_value',
      sql`${t.gender} IS NOT NULL OR ${t.vocative} IS NOT NULL`,
    ),
    // Vyhledání při každém zápisu kontaktu, musí být O(1).
    uniqueIndex('uq_name_overrides__ws_kind_key').on(t.workspaceId, t.kind, t.nameKey),
  ],
);

export const segments = pgTable(
  'segments',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    kind: text().$type<'dynamic' | 'static'>().notNull().default('dynamic'),
    presetKey: text(),
    definition: jsonb().notNull(),
    definitionHash: bytea().notNull(), // SHA-256 kanonického JSON, detekce změny
    astVersion: smallint().notNull().default(1),
    cachedCount: bigint({ mode: 'number' }),
    cachedIsExact: boolean(),
    cachedAt: timestamp({ withTimezone: true }),
    cachedDurationMs: integer(),
    recomputeState: text()
      .$type<'idle' | 'queued' | 'running' | 'error'>()
      .notNull()
      .default('idle'),
    lastErrorCode: text(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('ck_segments__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check('ck_segments__kind', sql`${t.kind} IN ('dynamic','static')`),
    check(
      'ck_segments__recompute_state',
      sql`${t.recomputeState} IN ('idle','queued','running','error')`,
    ),
    uniqueIndex('uq_segments__workspace_name')
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    // Plánovač přepočtu bere segmenty s nejstarším cached_at.
    // NULLS FIRST kvůli nově vytvořeným, které cached_at ještě nemají.
    index('idx_segments__stale')
      .on(t.cachedAt.nullsFirst())
      .where(sql`${t.deletedAt} IS NULL AND ${t.kind} = 'dynamic'`),
  ],
);

export const segmentMembers = pgTable(
  'segment_members',
  {
    segmentId: uuid()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_segment_members', columns: [t.segmentId, t.contactId] }),
    // "Ve kterých segmentech kontakt je" z detailu kontaktu, a zároveň jediný
    // použitelný index pro kaskádu z workspaces.
    index('idx_segment_members__ws_contact').on(t.workspaceId, t.contactId, t.segmentId),
  ],
);

export const forms = pgTable(
  'forms',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    slug: text().notNull(),
    fields: jsonb().notNull().default([]),
    design: jsonb().notNull().default({}),
    customCss: text(),
    listIds: uuid().array().notNull().default([]),
    tagIds: uuid().array().notNull().default([]),
    doubleOptIn: boolean().notNull().default(true),
    consentText: text(),
    consentRequired: boolean().notNull().default(true),
    legalBasis: text().notNull().default('consent'),
    honeypotField: text().notNull().default('website'),
    minFillSeconds: smallint().notNull().default(2),
    allowedOrigins: text().array().notNull().default([]),
    captchaProvider: text(),
    captchaConfig: jsonb(),
    redirectUrl: text(),
    successMessage: jsonb().notNull().default({}),
    active: boolean().notNull().default(true),
    /**
     * Šablona e-mailu, který přijde člověku po vyplnění formuláře (migrace 0015).
     * NULL znamená, že formulář žádný e-mail neposílá.
     *
     * Cizí klíč `fk_forms__delivery_template` je JEN v migraci, ne tady, stejně
     * jako u `lists.confirmation_template_id`. Zapsat ho přes `.references(() =>
     * templates.id)` by znamenalo import z `content.ts` do `contacts.ts`, a ten
     * modul importuje kontakty zpátky.
     */
    deliveryTemplateId: uuid(),
    submissionCount: bigint({ mode: 'number' }).notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Neuhodnutelný slug: veřejný endpoint /f/{slug} hledá bez znalosti projektu.
    check('ck_forms__slug', sql`${t.slug} ~ '^[a-z0-9]{16,32}$'`),
    check(
      'ck_forms__custom_css_len',
      sql`${t.customCss} IS NULL OR char_length(${t.customCss}) <= 20000`,
    ),
    check('ck_forms__min_fill_seconds', sql`${t.minFillSeconds} BETWEEN 0 AND 60`),
    check(
      'ck_forms__captcha_provider',
      sql`${t.captchaProvider} IS NULL OR
    ${t.captchaProvider} IN ('none','turnstile','hcaptcha')`,
    ),
    uniqueIndex('uq_forms__slug').on(t.slug),
    index('idx_forms__ws_created').on(t.workspaceId, t.createdAt.desc()),
  ],
);

export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    formId: uuid()
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    status: text().$type<'accepted' | 'rejected' | 'dropped'>().notNull(),
    errorCode: text(),
    payload: jsonb().notNull().default({}),
    pageUrl: text(),
    ip: inet(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_form_submissions__status', sql`${t.status} IN ('accepted','rejected','dropped')`),
    index('idx_form_submissions__form_created').on(t.formId, t.createdAt.desc()),
    index('idx_form_submissions__ws_created').on(t.workspaceId, t.createdAt),
  ],
);

export const inboundEndpoints = pgTable(
  'inbound_endpoints',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    slug: text().notNull(),
    signatureMode: text().notNull().default('hmac_sha256'),
    signatureConfig: jsonb().notNull().default({}),
    // Obálka enc:v1:<base64>, context 'inbound_endpoint'. TEXT, ne bytea:
    // kontrakt 4.10.4 žádá text kvůli dohledatelnosti při rotaci klíčů
    // a stejný tvar mají webhook_endpoints.secret_encrypted
    // i sending_providers.config_encrypted. Dvě různé signatury pro tutéž
    // obálku znamenají dvě různé cesty k dešifrování.
    secretEncrypted: text(),
    ipAllowlist: inetArray()
      .notNull()
      .default(sql`'{}'::inet[]`),
    mapping: jsonb().notNull().default({}),
    mappingVersion: integer().notNull().default(1),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_inbound_endpoints__slug', sql`${t.slug} ~ '^[a-z0-9]{24,40}$'`),
    check(
      'ck_inbound_endpoints__signature_mode',
      sql`${t.signatureMode} IN
    ('none','hmac_sha256','shared_secret','basic')`,
    ),
    uniqueIndex('uq_inbound_endpoints__slug').on(t.slug),
    index('idx_inbound_endpoints__ws_created').on(t.workspaceId, t.createdAt),
  ],
);

/**
 * Deduplikace přes hranici měsíce. inbound_deliveries je partitionovaná, takže
 * unikátní index na ní musí obsahovat partiční klíč a přes měsíc nefunguje.
 */
export const inboundDedup = pgTable(
  'inbound_dedup',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    endpointId: uuid()
      .notNull()
      .references(() => inboundEndpoints.id, { onDelete: 'cascade' }),
    externalId: text().notNull(),
    deliveryId: uuid().notNull(),
    // Druhá složka klíče inbound_deliveries. Bez ní projde dohledání doručení
    // podle deliveryId všemi oddíly; je to tentýž vzor jako message_created_at
    // a hlídá ho registr PARTITIONED_REFERENCES, ne jmenovitý test.
    deliveryCreatedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // workspace_id v čele PK: endpointId sice projekt jednoznačně určuje,
    // ale politika RLS se pak vyhodnocuje nad indexovaným sloupcem a upsert
    // z jobu nemůže omylem trefit cizí projekt. Unikátnost se tím nemění.
    primaryKey({
      name: 'pk_inbound_dedup',
      columns: [t.workspaceId, t.endpointId, t.externalId],
    }),
    index('idx_inbound_dedup__created').on(t.createdAt),
  ],
);

export const gdprRequests = pgTable(
  'gdpr_requests',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    // Plaintext se tady NIKDY neukládá. Otisk se počítá stejným receptem jako
    // suppressions.fingerprint a stejně jako tam se ukládá s pokolením klíče.
    subjectEmailFingerprint: bytea().notNull(),
    subjectEmailFingerprintKeyId: smallint().notNull(),
    type: text().notNull(),
    mode: text(), // jen u type='erasure'
    status: text().notNull(),
    channel: text().notNull(),
    requestedAt: timestamp({ withTimezone: true }).notNull(),
    dueAt: timestamp({ withTimezone: true }).notNull(), // requested_at + 1 měsíc, čl. 12 odst. 3
    extendedUntil: timestamp({ withTimezone: true }),
    extensionReason: text(),
    verifiedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    exportId: uuid().references(() => exports.id, { onDelete: 'set null' }),
    affected: jsonb().notNull().default({}),
    rejectionReason: text(),
    requestedBy: text(),
    processedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ck_gdpr_requests__type',
      sql`${t.type} IN
    ('access','portability','erasure','rectification','restriction','objection')`,
    ),
    check('ck_gdpr_requests__mode', sql`${t.mode} IS NULL OR ${t.mode} IN ('anonymize','purge')`),
    check(
      'ck_gdpr_requests__status',
      sql`${t.status} IN
    ('received','verifying','processing','completed','rejected','failed')`,
    ),
    check('ck_gdpr_requests__channel', sql`${t.channel} IN ('preference_center','admin','api')`),
    // Panel "co je po termínu" je hlavní pohled v téhle tabulce.
    index('idx_gdpr_requests__ws_due')
      .on(t.workspaceId, t.dueAt)
      .where(sql`${t.status} IN ('received','verifying','processing')`),
    index('idx_gdpr_requests__ws_created').on(t.workspaceId, t.createdAt.desc()),
    index('idx_gdpr_requests__ws_fingerprint').on(t.workspaceId, t.subjectEmailFingerprint),
  ],
);

export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    target: text().notNull(),
    retainDays: integer().notNull(),
    action: text().$type<'delete' | 'anonymize'>().notNull(),
    enabled: boolean().notNull().default(true),
    lastRunAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ck_retention_policies__target',
      sql`${t.target} IN
    ('import_files','import_errors','form_submissions','inbound_deliveries',
     'unconfirmed_subscriptions','inactive_contacts','exports')`,
    ),
    check('ck_retention_policies__retain_days', sql`${t.retainDays} BETWEEN 1 AND 3650`),
    check('ck_retention_policies__action', sql`${t.action} IN ('delete','anonymize')`),
    uniqueIndex('uq_retention_policies__workspace_target').on(t.workspaceId, t.target),
  ],
);

export const retentionRuns = pgTable(
  'retention_runs',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    policyId: uuid().references(() => retentionPolicies.id, { onDelete: 'set null' }),
    target: text().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    scanned: bigint({ mode: 'number' }).notNull().default(0),
    affected: bigint({ mode: 'number' }).notNull().default(0),
    status: text().notNull(),
    errorDetail: text(),
  },
  (t) => [
    check(
      'ck_retention_runs__status',
      sql`${t.status} IN
    ('running','completed','partial','failed')`,
    ),
    index('idx_retention_runs__ws_started').on(t.workspaceId, t.startedAt.desc()),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type ContactInsert = typeof contacts.$inferInsert;
export type ContactField = typeof contactFields.$inferSelect;
export type ContactFieldInsert = typeof contactFields.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type TagInsert = typeof tags.$inferInsert;
export type ContactTag = typeof contactTags.$inferSelect;
export type ContactTagInsert = typeof contactTags.$inferInsert;
export type List = typeof lists.$inferSelect;
export type ListInsert = typeof lists.$inferInsert;
export type ListSubscription = typeof listSubscriptions.$inferSelect;
export type ListSubscriptionInsert = typeof listSubscriptions.$inferInsert;
export type SubscriptionConfirmation = typeof subscriptionConfirmations.$inferSelect;
export type SubscriptionConfirmationInsert = typeof subscriptionConfirmations.$inferInsert;
export type Consent = typeof consents.$inferSelect;
export type ConsentInsert = typeof consents.$inferInsert;
export type ContactConsentState = typeof contactConsentState.$inferSelect;
export type ContactConsentStateInsert = typeof contactConsentState.$inferInsert;
export type Suppression = typeof suppressions.$inferSelect;
export type SuppressionInsert = typeof suppressions.$inferInsert;
export type Import = typeof imports.$inferSelect;
export type ImportInsert = typeof imports.$inferInsert;
export type ImportError = typeof importErrors.$inferSelect;
export type ImportErrorInsert = typeof importErrors.$inferInsert;
export type Export = typeof exports.$inferSelect;
export type ExportInsert = typeof exports.$inferInsert;
export type NameOverride = typeof nameOverrides.$inferSelect;
export type NameOverrideInsert = typeof nameOverrides.$inferInsert;
export type Segment = typeof segments.$inferSelect;
export type SegmentInsert = typeof segments.$inferInsert;
export type SegmentMember = typeof segmentMembers.$inferSelect;
export type SegmentMemberInsert = typeof segmentMembers.$inferInsert;
export type Form = typeof forms.$inferSelect;
export type FormInsert = typeof forms.$inferInsert;
export type FormSubmission = typeof formSubmissions.$inferSelect;
export type FormSubmissionInsert = typeof formSubmissions.$inferInsert;
export type InboundEndpoint = typeof inboundEndpoints.$inferSelect;
export type InboundEndpointInsert = typeof inboundEndpoints.$inferInsert;
export type InboundDedup = typeof inboundDedup.$inferSelect;
export type InboundDedupInsert = typeof inboundDedup.$inferInsert;
export type GdprRequest = typeof gdprRequests.$inferSelect;
export type GdprRequestInsert = typeof gdprRequests.$inferInsert;
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;
export type RetentionPolicyInsert = typeof retentionPolicies.$inferInsert;
export type RetentionRun = typeof retentionRuns.$inferSelect;
export type RetentionRunInsert = typeof retentionRuns.$inferInsert;
