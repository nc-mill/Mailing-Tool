/**
 * Typy sdílené celou doménou kontaktů. Leží mimo `repo/`, protože je potřebuje
 * i čistá vrstva pravidel, která databázi nevidí.
 */

/**
 * Režim zápisu kontaktu. Platí pro všechny čtyři kanály (API, formulář, příchozí
 * webhook, import) a mění JEN chování nad poli kontaktu, nikdy nad seznamy,
 * štítky a souhlasy. Viz pravidlo 5 v `write.ts`.
 *
 * skip      existující kontakt se nezmění vůbec
 * update    přepíšou se jen neprázdné hodnoty
 * overwrite přepíše se i prázdnou hodnotou
 * create    zapisuje se jen nový kontakt, existující se přeskočí
 */
export type UpsertMode = 'skip' | 'update' | 'overwrite' | 'create';

/**
 * Stav kontaktu podle `ck_contacts__status`. Hodnota `subscribed` NEEXISTUJE
 * a nikdy neexistovala; kdo ji použije v dotazu, dostane nula řádků.
 */
export type ContactStatus =
  'active' | 'unconfirmed' | 'unsubscribed' | 'bounced' | 'complained' | 'deleted';
