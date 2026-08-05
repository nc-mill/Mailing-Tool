// packages/db/src/rls.ts

/** Tabulky bez sloupce workspace_id. Test "každá tabulka mimo whitelist má
 *  workspace_id" se řídí tímhle seznamem.
 *
 *  workspaces je na seznamu, ale RLS na ní PŘESTO BĚŽÍ, jen se izoluje přes id.
 *  Whitelist říká "nemá sloupec workspace_id", ne "nemá RLS". */
export const TABLES_WITHOUT_WORKSPACE_ID: readonly string[] = [
  'users',
  'sessions',
  'password_reset_tokens',
  'system_settings',
  // Pokolení šifrovacího klíče je vlastnost instalace, ne projektu (R28).
  'secret_key_generations',
  'workspaces',
  // Část 5 je vyjímá výslovně: klíčem je náhodný nonce a řádek žije 15 minut.
  'identity_token_uses',
  // Globální provozní data, žádný obsah zákazníka.
  'proxy_ranges',
  // Rozsah limitu nese textový klíč scope:identifier:window, ne sloupec (R36).
  // Přihlašovací a IP limity žádný workspace kontext nemají, takže by je
  // politika s WITH CHECK vyhodnoceným jako NULL odmítla a limiter by přestal
  // fungovat právě na přihlašování.
  'rate_limits',
];

/** Tabulky, na kterých se RLS vůbec nezapíná. */
export const TABLES_WITHOUT_RLS: readonly string[] = [
  'users',
  'sessions',
  'password_reset_tokens',
  'system_settings',
  'secret_key_generations',
  'identity_token_uses',
  'proxy_ranges',
  'rate_limits',
];

export type PolicyKind = 'ws_isolation' | 'ws_isolation_audit' | 'ws_isolation_self';

export type TablePolicy = {
  table: string;
  policy: PolicyKind;
  /** Sloupec, přes který se izolace vyhodnocuje. */
  isolationColumn: string;
  /** Další politiky, které na tabulce legitimně existují. */
  extraPolicies?: readonly string[];
};

/** Tabulky, na které má sender grant, a proto potřebují permisivní politiku
 *  sender_bypass. Role mlain_sender nemá BYPASSRLS a nikdy nenastavuje
 *  mlain.workspace_id, protože pracuje napříč projekty. Bez sender_bypass
 *  by claim dotaz vracel NULA ŘÁDKŮ VŽDY a nikdo by se to nedozvěděl,
 *  protože prázdná dávka je legitimní stav. */
export const SENDER_BYPASS_TABLES: readonly string[] = [
  'messages',
  'campaigns',
  'sending_providers',
  'campaign_links',
  'workspaces',
  'suppressions',
  'message_events',
  // Agregovaná varování z renderu. Grant tu byl od začátku, politika ne, takže
  // zápis by NIKDY neprošel: sender by dostal nejdřív permission denied
  // (INSERT ... ON CONFLICT DO UPDATE čte existující řádek, potřebuje tedy
  // i SELECT) a po jeho doplnění "new row violates row-level security policy".
  // Report varování by byl navždy prázdný a nikdo by se nedozvěděl proč.
  'campaign_render_warnings',
];

/** Tabulky, na které má mlain_maintenance grant, a proto potřebují
 *  permisivní politiku maintenance_bypass. Retenční job běží NAPŘÍČ projekty
 *  a workspace kontext nenastavuje, takže by ws_isolation nepustila nic
 *  a DELETE by ovlivnil nula řádků BEZ CHYBY. Retence osobních údajů by se
 *  tiše neprovedla, což je ta nejhorší varianta selhání, jakou tahle tabulka má. */
export const MAINTENANCE_BYPASS_TABLES: readonly string[] = ['web_events'];

/**
 * Tabulky, na které má mlain_maintenance výjimku kvůli SYSTÉMOVÝM SKENŮM
 * napříč projekty (migrace 0009). Politika se jmenuje `maintenance_scan`,
 * ne `maintenance_bypass`, a je to rozdíl v podstatě, ne v názvu: bypass je
 * `USING (true)` pro všechny příkazy, kdežto scan je `FOR SELECT` a nic víc.
 *
 * Proč zrovna tyhle tři:
 *   workspaces     ... plánovač kampaní a rekonciliace outboxu potřebují výčet
 *                      projektů; bez něj se naplánovaná kampaň NEODEŠLE
 *   campaigns      ... hlídač běžících a obnova po vyčerpané kvótě
 *   sender_domains ... rekontrola odesílacích domén
 *
 * Nic dalšího tu být nesmí. Jakmile úloha zná ID projektu, pokračuje pod
 * aplikační rolí v kontextu toho projektu a dopadá na ni RLS jako na cokoli
 * jiného.
 */
export const MAINTENANCE_SCAN_TABLES: readonly string[] = [
  'workspaces',
  'campaigns',
  'sender_domains',
];

const WS_ISOLATION_TABLES = [
  // identita a platforma
  'memberships',
  'invitations',
  'api_keys',
  'idempotency_keys',
  'webhook_endpoints',
  'webhook_events',
  'webhook_deliveries',
  // kontakty
  'contacts',
  'contact_fields',
  'tags',
  'contact_tags',
  'lists',
  'list_subscriptions',
  'subscription_confirmations',
  'consents',
  'contact_consent_state',
  'suppressions',
  'imports',
  'import_errors',
  'exports',
  'name_overrides',
  'segments',
  'segment_members',
  'forms',
  'form_submissions',
  'inbound_endpoints',
  'inbound_dedup',
  'inbound_deliveries',
  'gdpr_requests',
  'retention_policies',
  'retention_runs',
  // obsah
  'assets',
  'templates',
  'template_versions',
  'brand_profiles',
  'brand_extractions',
  'ai_provider_credentials',
  'ai_conversations',
  'ai_messages',
  'ai_usage_daily',
  'content_snippets',
  // obsah, podřízené tabulky assets (rozhodnutí R26)
  'asset_variants',
  'asset_references',
  // kampaně
  'sending_providers',
  'sender_domains',
  // Předvolby odesílatele (migrace 0013). Sender na ně grant NEMÁ a mít nemá:
  // v okamžiku odesílání jsou hodnoty dávno zkopírované v kampani, takže by
  // grant znamenal jen další výjimku z izolace bez užitku.
  'sender_identities',
  'campaigns',
  'campaign_content_variants',
  'campaign_links',
  'deliverability_snapshots',
  'campaign_audience_progress',
  'campaign_render_warnings',
  'messages',
  'message_events',
  'provider_event_receipts',
  // tracking
  'web_event_months',
  'identities',
  'identity_bindings',
  'identity_merges',
  'tracking_domains',
  'contact_engagement',
  'campaign_stats',
  'campaign_stats_buckets',
  'campaign_link_stats',
  'web_events',
  'message_engagement',
] as const;

export const RLS_REGISTRY: readonly TablePolicy[] = [
  ...WS_ISOLATION_TABLES.map((table): TablePolicy => ({
    table,
    policy: 'ws_isolation',
    isolationColumn: 'workspace_id',
    // Klíč se pod exactOptionalPropertyTypes nesmí objevit s hodnotou
    // undefined, proto se u tabulek bez senderu nepřidává vůbec.
    ...(SENDER_BYPASS_TABLES.includes(table) ? { extraPolicies: ['sender_bypass'] } : {}),
  })),
  {
    table: 'audit_log',
    policy: 'ws_isolation_audit',
    isolationColumn: 'workspace_id',
  },
  {
    table: 'workspaces',
    policy: 'ws_isolation_self',
    isolationColumn: 'id',
    extraPolicies: [
      'ws_member_visibility',
      'ws_insert_bootstrap',
      'sender_bypass',
      // Ověření API klíče JOINuje workspaces kvůli deleted_at a běží úplně bez
      // kontextu. Bez téhle politiky by JOIN zahodil řádek, který api_key_lookup
      // právě pustila, a každý požadavek s Bearer klíčem by skončil na
      // `unauthenticated`, aniž by kde spadl.
      'ws_api_key_lookup',
      // Systémové skeny napříč projekty (migrace 0009). Čtení je oddělené od
      // mazání schválně: `maintenance_scan` je FOR SELECT, kdežto
      // `maintenance_purge` je FOR DELETE a pouští jen projekty, které UŽ JSOU
      // měkce smazané. Jedna politika `USING (true)` pro obojí by roli dala
      // právo smazat živý projekt se všemi daty.
      'maintenance_scan',
      'maintenance_purge',
    ],
  },
];

/** Politiky, které legitimně existují mimo hlavní izolační politiku tabulky. */
export const EXTRA_POLICIES: Readonly<Record<string, readonly string[]>> = {
  memberships: ['user_own_memberships'],
  // Ověření klíče čte api_keys MIMO workspace kontext, protože ten se z klíče
  // teprve zjišťuje, a zápis last_used_at jde toutéž cestou. Bez obou politik
  // vrací každý požadavek s hlavičkou Authorization: Bearer `unauthenticated`.
  api_keys: ['api_key_lookup', 'api_key_touch'],
  // Pozvánku přijímá uživatel, který v projektu ještě není. Bez téhle politiky
  // vrací acceptInvitation vždy 404 a z hlášky to nikdo nepozná.
  invitations: ['invitation_token_lookup'],
  // Globální auditní záznamy patří uživateli, ne projektu. Bez téhle politiky
  // je repo/audit-global.ts nespustitelné.
  audit_log: ['user_own_global_audit'],
  web_events: ['maintenance_bypass'],
  // Veřejný výdej obrázku z e-mailu (migrace 0011). Poštovní klient příjemce
  // není přihlášený a v adrese má jen `public_id`, takže workspace kontext
  // neexistuje a `ws_isolation` by nevrátila ani řádek.
  //
  // V registru to chybělo od chvíle, kdy ta migrace vznikla, takže
  // `rls-registry.test.ts` padal na „assets.asset_public_lookup není
  // v registru" a exaktní počet politik neseděl o jedna. Nesouvisí to
  // s předvolbami odesílatele, jen se to tímhle souborem opravuje.
  assets: ['asset_public_lookup'],
  // Systémové skeny napříč projekty (migrace 0009), jen pro čtení.
  campaigns: ['maintenance_scan'],
  sender_domains: ['maintenance_scan'],
};

/** Úplný seznam očekávaných politik na tabulce, včetně těch doplňkových. */
export function expectedPolicies(table: string): string[] {
  const entry = RLS_REGISTRY.find((row) => row.table === table);
  if (!entry) return [];
  return [entry.policy, ...(entry.extraPolicies ?? []), ...(EXTRA_POLICIES[table] ?? [])];
}
