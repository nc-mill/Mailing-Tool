/**
 * Slovník `ck_message_events__type` z P03. Zdroj je omezení v databázi,
 * ne tenhle soubor: katalogový test níž je porovnává proti běžící databázi.
 *
 * Tvrdost odrazu nese TYP, ne `subtype`. Dřívější návrh části 5 s hodnotami
 * `bounce` a `complaint` odmítlo rozhodnutí R5 v P03. Filtr na neexistující
 * hodnotu **nic nevrátí a nic nespadne**, takže by čítače zůstaly nulové.
 */
export const EVENT_TYPES = [
  'sent',
  'rejected',
  'delivered',
  'delivery_delayed',
  'bounced_hard',
  'bounced_soft',
  'complained',
  'render_failed',
  'open',
  'click',
  'unsubscribe',
  'circuit_breaker_open',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Odraz je jeden pojem se dvěma tvrdostmi. Report je zobrazuje dohromady. */
export const BOUNCE_TYPES = ['bounced_hard', 'bounced_soft'] as const;

/** Typy, které se objevují v časové ose kontaktu. Provozní se nezobrazují. */
export const TIMELINE_EVENT_TYPES = [
  'delivered',
  'bounced_hard',
  'bounced_soft',
  'complained',
  'open',
  'click',
  'unsubscribe',
] as const;

/** Podtypy prokliku, které nedělal člověk. Do ověřených prokliků nepatří. */
export const NON_HUMAN_CLICK_SUBTYPES = ['scanner', 'bot', 'prefetch'] as const;

/** Podtypy otevření, které nedělal člověk a v ose se nezobrazují vůbec. */
export const HIDDEN_OPEN_SUBTYPES = ['bot'] as const;
