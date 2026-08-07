import { z } from 'zod';
import { envBool, envCsv, envFloat, envInt, envUrl } from './primitives';

/** Část 2: kontakty, souhlasy, import, export, segmenty, GDPR. Všechny W a K. */
export const contactsShape = {
  CONTACT_FIELD_LIMIT: envInt(1, 1000).default(100),
  CONTACT_INDEXED_FIELD_LIMIT: envInt(1, 64).default(8),
  CONTACT_ATTRIBUTES_MAX_BYTES: envInt(4096, 4194304).default(262144),
  CONTACT_SEARCH_INDEX_ENABLED: envBool().prefault('true'),
  IMPORT_MAX_FILE_BYTES: envInt(1048576, 2147483648).default(209715200),
  IMPORT_MAX_ROWS: envInt(1, 50000000).default(5000000),
  IMPORT_MAX_COLUMNS: envInt(1, 1000).default(200),
  IMPORT_MAX_CELL_CHARS: envInt(1, 1048576).default(8192),
  IMPORT_MAX_LINE_BYTES: envInt(1024, 16777216).default(65536),
  IMPORT_BATCH_SIZE: envInt(100, 10000).default(1000),
  IMPORT_MAX_STORED_ERRORS: envInt(1, 1000000).default(10000),
  IMPORT_SNIFF_BYTES: envInt(1024, 16777216).default(262144),
  IMPORT_WORKER_CONCURRENCY: envInt(1, 16).default(2),
  IMPORT_PREVIEW_TTL_HOURS: envInt(1, 720).default(24),
  IMPORT_STALE_MINUTES: envInt(1, 1440).default(10),
  IMPORT_INMEMORY_DEDUP_MAX_ROWS: envInt(1000, 50000000).default(1000000),
  SEGMENT_PREVIEW_TIMEOUT_MS: envInt(500, 30000).default(3000),
  SEGMENT_RECOUNT_CONCURRENCY: envInt(1, 32).default(2),
  SEGMENT_MAX_CONDITIONS: envInt(1, 1000).default(100),
  RETENTION_MIN_DAYS: envInt(1, 3650).default(1),
  DISPOSABLE_DOMAINS_FILE: z.string().min(1).optional(),
  FORM_RATE_LIMIT_PER_IP_MINUTE: envInt(1, 100000).default(5),
  INBOUND_MAX_BODY_BYTES: envInt(1024, 104857600).default(1048576),
  EXPORT_TTL_HOURS: envInt(1, 720).default(24),
  GDPR_EXPORT_TTL_DAYS: envInt(1, 365).default(7),
};

/** Část 3: obsah, assety, značka, AI, verze šablon. Všechny W a K. */
export const contentShape = {
  ASSET_BASE_URL: envUrl().optional(),
  ASSET_QUOTA_MB: envInt(100, 1000000).default(2048),
  ASSET_MAX_UPLOAD_MB: envInt(1, 100).default(10),
  ASSET_REQUIRE_SIGNED_URL: envBool().prefault('false'),
  ASSET_RATE_LIMIT_PER_IP: envInt(0, 100000).default(0),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  BRAND_FETCH_ENABLED: envBool().prefault('true'),
  // Schválně true, na rozdíl od odchozích webhooků: stahování značky je čtení
  // veřejné stránky, kde se nepřenáší žádné tajemství, a weby zákazníků na
  // http reálně existují (část 1, 4.9).
  BRAND_FETCH_ALLOW_HTTP: envBool().prefault('true'),
  BRAND_FETCH_ALLOW_PRIVATE_NETWORKS: envBool().prefault('false'),
  BRAND_FETCH_ALLOWED_HOSTS: envCsv().prefault(''),
  BRAND_FETCH_BLOCKED_HOSTS: envCsv().prefault(
    'metadata.google.internal,metadata.goog,instance-data,metadata',
  ),
  BRAND_FETCH_RESPECT_ROBOTS: envBool().prefault('true'),
  BRAND_FETCH_DNS_SERVERS: envCsv().prefault(''),
  BRAND_FETCH_DNS_TIMEOUT_MS: envInt(200, 10000).default(2000),
  BRAND_FETCH_CONNECT_TIMEOUT_MS: envInt(500, 20000).default(3000),
  BRAND_FETCH_HEADERS_TIMEOUT_MS: envInt(500, 30000).default(5000),
  BRAND_FETCH_BODY_TIMEOUT_MS: envInt(1000, 60000).default(10000),
  BRAND_FETCH_TOTAL_TIMEOUT_MS: envInt(5000, 120000).default(30000),
  BRAND_FETCH_MAX_HTML_BYTES: envInt(1024, 104857600).default(2097152),
  BRAND_FETCH_MAX_CSS_BYTES: envInt(1024, 104857600).default(524288),
  BRAND_FETCH_MAX_IMAGE_BYTES: envInt(1024, 104857600).default(5242880),
  BRAND_FETCH_MAX_TOTAL_BYTES: envInt(1024, 1073741824).default(20971520),
  BRAND_FETCH_MAX_CSS_FILES: envInt(0, 10).default(3),
  BRAND_FETCH_MAX_IMAGE_FILES: envInt(0, 20).default(8),
  BRAND_FETCH_RATE_PER_HOUR: envInt(1, 1000).default(10),
  BRAND_FETCH_CONCURRENCY: envInt(1, 20).default(3),
  BRAND_EXTRACTION_INFER_TONE: envBool().prefault('true'),
  AI_ENABLED: envBool().prefault('true'),
  AI_REQUEST_TIMEOUT_MS: envInt(10000, 600000).default(120000),
  AI_MAX_TOKENS_PER_REQUEST: envInt(256, 1000000).default(16000),
  AI_RATE_PER_HOUR: envInt(1, 100000).default(60),
  AI_CONVERSATION_RETENTION_DAYS: envInt(0, 3650).default(90),
  AI_ALLOW_CUSTOM_BASE_URL: envBool().prefault('true'),
  TEMPLATE_VERSION_RETENTION_DAYS: envInt(0, 3650).default(180),
  TEMPLATE_VERSION_MAX_UNPINNED: envInt(5, 1000).default(50),
};

/** Část 4a: kampaně, provideři, doručitelnost, retence zpráv. */
export const campaignsShape = {
  AMBIGUOUS_DISPATCH_POLICY_SES: z.enum(['retry', 'fail']).default('fail'),
  AMBIGUOUS_DISPATCH_POLICY_SMTP: z.enum(['retry', 'fail']).default('retry'),
  CAMPAIGN_MATERIALIZE_BATCH_SIZE: envInt(100, 50000).default(5000),
  CAMPAIGN_MATERIALIZE_MAX_MINUTES: envInt(1, 1440).default(60),
  CAMPAIGN_MAX_RECIPIENTS: envInt(1, 50000000).default(2000000),
  CAMPAIGN_PARTIAL_THRESHOLD: envFloat(0, 1).default(0.01),
  CAMPAIGN_SCHEDULE_CATCHUP_HOURS: envInt(0, 168).default(6),
  CAMPAIGN_UNDO_WINDOW_SECONDS: envInt(0, 900).default(60),
  CAMPAIGN_QUOTA_PAUSE_REMAINING: envInt(0, 1000000).default(100),
  CAMPAIGN_QUOTA_RESUME_REMAINING: envInt(0, 1000000).default(1000),
  CAMPAIGN_TEST_SEND_PER_HOUR: envInt(1, 1000).default(20),
  SOFT_BOUNCE_THRESHOLD: envInt(1, 20).default(3),
  SOFT_BOUNCE_WINDOW_DAYS: envInt(1, 365).default(30),
  DELIVERABILITY_BOUNCE_GUARD_RATE: envFloat(0, 1).default(0.08),
  DELIVERABILITY_COMPLAINT_GUARD_RATE: envFloat(0, 1).default(0.003),
  DELIVERABILITY_BOUNCE_WARN_RATE: envFloat(0, 1).default(0.04),
  DELIVERABILITY_COMPLAINT_WARN_RATE: envFloat(0, 1).default(0.001),
  DELIVERABILITY_CONTENT_BOUNCE_LIMIT: envInt(1, 1000000).default(100),
  DELIVERABILITY_GUARD_MIN_SENT: envInt(1, 1000000).default(500),
  // Retence má reálně měsíční granularitu: partition se odpojují po měsících,
  // takže 90 dní drží 90 až 120 dní (část 1, 4.9). Je to v `.env.example`
  // i v `docs/operations/partitions-retention.md`.
  //
  // Obě proměnné čte `ops/partition-retention.ts`, tedy příkaz
  // `mlain partitions`. Do té doby to byly MRTVÉ proměnné: stály tady
  // s výchozími hodnotami a v běhovém kódu je nikdo nečetl, takže odeslaná
  // pošta v produktu zůstávala navždy.
  MESSAGE_RETENTION_DAYS: envInt(7, 3650).default(90),
  MESSAGE_EVENT_RETENTION_DAYS: envInt(7, 3650).default(365),
  SNS_CERT_CACHE_SECONDS: envInt(60, 604800).default(86400),
  SNS_STORE_RAW_EVENTS: envBool().prefault('true'),
  DNS_CHECK_TIMEOUT_MS: envInt(500, 30000).default(3000),
  DNS_CHECK_CONCURRENCY: envInt(1, 50).default(10),
  AWS_API_TIMEOUT_MS: envInt(1000, 60000).default(5000),
};

/** Část 5: tracking, události, identity, retence. */
export const trackingShape = {
  TRACKING_IDENTITY_TOKEN_TTL_SECONDS: envInt(60, 3600).default(900),
  TRACKING_MERGE_WINDOW_DAYS: envInt(1, 365).default(30),
  TRACKING_MERGE_MAX_EVENTS: envInt(100, 1000000).default(10000),
  TRACKING_RETENTION_MONTHS: envInt(3, 120).default(37),
  TRACKING_APPLE_RELAY_RANGES: envBool().prefault('false'),
  // Instalační pojistka nad projektovým nastavením `store_ip`. Rozhodnutí
  // zadavatele má dvě páky a IP se uloží, jen když jsou zapnuté OBĚ: tahle
  // (provozovatel je správce údajů) a projektová. P10 ji čte v tracking/config.ts,
  // takže bez ní by se jeho balíček neotypoval.
  TRACKING_ALLOW_IP_STORAGE: envBool().prefault('false'),
  TRACKING_STORE_COUNTRY: envBool().prefault('false'),
  TRACKING_GEOIP_DB_PATH: z.string().min(1).optional(),
  TRACKING_STRIP_QUERY_PARAMS: envCsv().prefault(''),
  TRACKING_PII_PROPERTY_KEYS: envCsv().prefault(''),
  TRACKING_WRITER_FLUSH_MS: envInt(50, 5000).default(250),
  TRACKING_WRITER_BATCH: envInt(50, 5000).default(500),
  TRACKING_SSE_MAX_CONNECTIONS: envInt(10, 10000).default(500),
  TRACKING_ALLOW_SERVERSIDE_PUBLIC_KEY: envBool().prefault('false'),
  TRACKING_PROPERTIES_MAX_KEYS: envInt(1, 256).default(32),
  TRACKING_PROPERTIES_MAX_DEPTH: envInt(1, 10).default(3),
  TRACKING_PROPERTIES_MAX_STRING: envInt(64, 16384).default(1024),
  TRACKING_IMPORT_BATCH_MAX_EVENTS: envInt(1, 5000).default(1000),
  /**
   * Strop pro dohledání kontaktu při prokliku. Když se do něj dohledání nevejde,
   * přesměrování odejde BEZ `ml_token`, tedy bez propojení návštěvy webu
   * s konkrétním příjemcem. Ztráta identity u jednoho kliku je menší škoda než
   * člověk čekající na stránku, ale jen dokud je strop nastavený na skutečné
   * chování databáze.
   *
   * VÝCHOZÍCH 250 ms MÍSTO PŮVODNÍCH 30 ms, a je to oprava podle měření, ne
   * zpřesnění. Strop nekryje jen samotný dotaz: `lookupMessage` otevírá vlastní
   * transakci se `SET LOCAL` kontextem, při minutí pouští dotazy dva (rovnost
   * a okno jedné sekundy), a hlavně do něj spadá i VYZVEDNUTÍ SPOJENÍ z bazénu.
   * Když v bazénu volné spojení není, součástí stropu je navázání nového,
   * u spravované databáze včetně TLS.
   *
   * Naměřeno 7. 8. 2026 proti PostgreSQL 18 v kontejneru NA TÉMŽE STROJI, tedy
   * v nejpříznivější možné variantě: studené volání, které otevírá spojení,
   * vyšlo ve třech bězích na 26, 33 a 42 ms, takže původní strop 30 ms
   * podstřeloval už na localhostu. Teplé minutí mělo p95 kolem 13 ms a maximum
   * 42 ms. Se skutečnou databází na síti by 30 ms neuspělo prakticky nikdy,
   * takže první proklik po vyprázdnění bazénu chodil bez identifikace.
   *
   * Vyšší strop nezdržuje běžný proklik: je to mez, ne čekání. Teplá trefa má
   * medián kolem 2 ms a odpovídá se hned, jak dotaz doběhne.
   */
  TRACKING_CONTACT_LOOKUP_TIMEOUT_MS: envInt(10, 5000).default(250),
};
