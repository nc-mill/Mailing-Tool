/**
 * Ikona události. UZAVŘENÝ VÝČET, ne libovolný uzel.
 *
 * Kterou kresbu má „otevřený e-mail", rozhoduje návrhový systém, ne obrazovka:
 * ikony se v tomhle repozitáři berou z jediného místa (`@mlain/ui/icons`) právě
 * proto, aby se tři obrazovky nerozešly ve třech odstínech téhož významu.
 * Volající proto posílá VÝZNAM (`open`), ne komponentu.
 */
export type TimelineIcon =
  'mail' | 'open' | 'click' | 'web' | 'contact' | 'consent' | 'problem' | 'generic';

export type TimelineEvent = {
  id: string;
  /** Typ události, například `page_view`, `email_open`, `consent_given`. */
  type: string;
  occurredAt: Date;
  /**
   * IKONA JE POJMENOVANÉ POLE, A JE TO OPRAVA TICHÉ ZTRÁTY (7. 8. 2026).
   *
   * Ikona se počítala v `features/reports/timeline/contact-timeline.tsx`, poctivě
   * se předávala adaptérem dál a ukládala se do `payload.icon`. Komponenta
   * `Timeline` ji ale NIKDY NEPŘEČETLA a kreslila natvrdo ikonu řetězu u každé
   * události, ať se stalo cokoli. Celá mapa patnácti typů na osm ikon byla mrtvý
   * kód a nevykreslila se ani jednou.
   *
   * PROČ TO NEODHALIL PŘEKLADAČ: `payload` je `Record<string, unknown>`, tedy
   * volný pytel. Do volného pytle jde vložit cokoli a na druhém konci nikdo
   * nepozná, že to nikdo nevybírá. Ani jedna strana neměla o čem lhát, protože
   * si nic neslíbily. Pojmenované pole tenhle tvar vady zavírá: příští vynechání
   * shodí typovou kontrolu místo toho, aby zmizelo v tichu.
   *
   * Nepovinné je schválně: `Timeline` používá i galerie a smluvní test, a událost
   * bez ikony je legitimní (dostane neutrální).
   */
  icon?: TimelineIcon | undefined;
  /**
   * Věta o události PRO ČTEČKU, ne pro vykreslení. Vykresluje se `renderSentence`,
   * protože věta může nést uzly; tenhle prostý text potřebuje `aria-label` kotvy,
   * který z uzlu spolehlivě sestavit nejde.
   */
  title?: string | undefined;
  payload: Record<string, unknown>;
};

export type TimelineItem =
  | { kind: 'single'; id: string; type: string; occurredAt: Date; event: TimelineEvent }
  | { kind: 'cluster'; id: string; type: string; occurredAt: Date; events: TimelineEvent[] };

export type DayGroup = {
  /** Klíč dne v zóně uživatele, tvar YYYY-MM-DD. */
  key: string;
  /** `today`, `yesterday` nebo `date`. Text dodává katalog. */
  label: 'today' | 'yesterday' | 'date';
  date: Date;
  items: TimelineItem[];
};
