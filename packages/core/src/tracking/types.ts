/** Typ trackovacího tokenu podle kontraktu 4.10.3 části 1. Znak, nikdy číslo. */
export type TrackingTokenType = 'o' | 'c' | 'i' | 'u';

export type OpenTokenFields = {
  type: 'o';
  workspaceId: string;
  messageId: string;
  /** Unixové sekundy, uint32. Lokátor partition, nikdy se nekontroluje proti expiraci. */
  messageCreatedAt: number;
};

export type ClickTokenFields = {
  type: 'c';
  workspaceId: string;
  messageId: string;
  /** campaign_links.id, tedy UUID. Nikdy pořadové číslo. */
  linkId: string;
  messageCreatedAt: number;
};

export type IdentityTokenFields = {
  type: 'i';
  workspaceId: string;
  contactId: string;
  campaignId: string;
  /** Přesně 8 bajtů z CSPRNG. */
  nonce: Uint8Array;
  /** Unixové sekundy, uint32. */
  expiresAt: number;
};

export type UnsubscribeTokenFields = {
  type: 'u';
  workspaceId: string;
  messageId: string;
  contactId: string;
  /** Samé nuly znamenají globální odhlášení, ne odhlášení ze seznamu. */
  listId: string;
  messageCreatedAt: number;
};

export type TrackingTokenFields =
  OpenTokenFields | ClickTokenFields | IdentityTokenFields | UnsubscribeTokenFields;

/** Chybové kódy tokenů. Vlastní je část 1, tahle část je jen používá. */
export type TokenErrorCode =
  | 'token_malformed'
  | 'token_signature_invalid'
  | 'token_type_mismatch'
  | 'token_unknown_key'
  | 'token_expired'
  | 'token_already_used';

export type OpenClass = 'human' | 'proxy_apple' | 'proxy_image' | 'bot' | 'unknown';
export type ClickClass = 'human' | 'scanner' | 'bot' | 'prefetch';

/**
 * Podtyp události `click` pro SYSTÉMOVÉ odkazy v patičce: odhlášení (`/u/`),
 * centrum předvoleb (`/p/`) a zobrazení v prohlížeči (`/v/`).
 *
 * Není to hodnota `ClickClass`. Ta odpovídá na otázku „klikl člověk, nebo
 * stroj", kdežto tenhle podtyp odpovídá na otázku „na co se kliklo". Proto
 * stojí vedle výčtu, ne v něm: kdyby v něm byl, musela by ho zpracovat každá
 * větev klasifikace, která rozhoduje o robotech, a to s ním nemá co dělat.
 *
 * ROZHODNUTÍ, PROČ SE SYSTÉMOVÝ PROKLIK MĚŘÍ ZVLÁŠŤ. Do míry prokliku se
 * NEZAPOČÍTÁVÁ. Míra prokliku měří zájem o obsah a odhlášení je pravý opak;
 * kdyby ho zvedalo, číslo by rostlo přesně ve chvíli, kdy zájem klesá, a nešlo
 * by srovnat s žádným jiným nástrojem na trhu. Zároveň se ale nesmí ztratit:
 * pro odesílatele je „člověk otevřel předvolby" cenná informace a na localhostu
 * je to dokonce JEDINÁ interakce z Gmailu, která vůbec může dorazit (pixel jde
 * přes proxy Googlu, systémový odkaz otevírá prohlížeč příjemce).
 *
 * Technicky se to drží samo: událost má `link_id = NULL`, a agregace
 * `process-engagement` bere do `campaign_stats` jen prokliky s odkazem.
 */
export const SYSTEM_CLICK_SUBTYPE = 'system';

/** Který systémový odkaz to byl. Zapisuje se do `metadata.system_link`. */
export const SYSTEM_LINK_KINDS = ['unsubscribe_page', 'preferences', 'webview'] as const;
export type SystemLinkKind = (typeof SYSTEM_LINK_KINDS)[number];

/**
 * Registr hodnot sloupce web_events.source. Vlastníkem je tahle část.
 * Přidání hodnoty znamená migraci CHECK plus doplnění do TimelineItem.source.
 */
export const EVENT_SOURCES = ['web', 'server', 'email', 'automation', 'import'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** Vynucuje ck_web_events__name. Stejný výraz používá i SDK, aby se chyba poznala dřív. */
export const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Bity open_class_mask v message_engagement, viz 2.6. */
export const OPEN_CLASS_BIT: Readonly<Record<OpenClass, number>> = Object.freeze({
  human: 1,
  proxy_apple: 2,
  proxy_image: 4,
  bot: 8,
  unknown: 16,
});

/** Klíče uvnitř jsonb jsou snake_case stejně jako klíče v API, viz 2.2. */
export type EventPage = {
  url: string;
  path: string;
  title?: string;
  referrer?: string;
  search?: string;
};

export type EventContext = {
  locale?: string;
  timezone?: string;
  screen?: { w: number; h: number };
  viewport?: { w: number; h: number };
  device?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  os?: string;
  browser?: string;
  /** ISO 3166-1 alpha-2. Jen když projekt zapnul ukládání země. */
  country?: string;
  /** Jen když provozovatel i projekt zapnuli ukládání IP. Výchozí stav je bez ní. */
  ip?: string;
  sdk?: { name: 'ml-web'; version: string };
  campaign?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  clock_skew_ms?: number;
  /** Jen u source='import': kdy se dávka nahrála. Čas vzniku je occurred_at. */
  imported_at?: string;
};

/** Odkaz na řádek partitionované tabulky nese vždy obě složky klíče, viz 2.1 části 1. */
export type MessageRef = { messageId: string; messageCreatedAt: Date };
export type WebEventRef = { webEventId: string; webEventReceivedAt: Date };
