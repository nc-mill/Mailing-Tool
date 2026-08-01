/**
 * Seznam jazyků. Přidání dalšího znamená nový adresář v `messages/`
 * a záznam tady. Žádná změna kódu jinde (12.8 části 6).
 *
 * Hodnoty se za běhu ověřují proti konfiguračním proměnným
 * SUPPORTED_LOCALES a DEFAULT_LOCALE, které vlastní P01.
 */
export const SUPPORTED_LOCALES = ['cs', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'cs';

/** Zdroj pravdy pro množinu klíčů. Katalog `cs` se proti němu porovnává. */
export const SOURCE_LOCALE: Locale = 'en';

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
