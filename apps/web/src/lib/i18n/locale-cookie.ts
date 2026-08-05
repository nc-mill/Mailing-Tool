import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '@mlain/i18n/locales';

/**
 * Jedno jediné místo, kde se v aplikaci zapisuje jazyk rozhraní.
 *
 * Jazyk uživatele je uložený v `users.locale`, jenže rozhraní se tím přímo
 * neřídí: `next-intl` hledá jazyk v pořadí
 *   1. prefix v adrese, 2. cookie `NEXT_LOCALE`, 3. hlavička `accept-language`,
 *   4. výchozí jazyk instalace
 * (ověřeno ve zdroji knihovny, soubor `middleware/resolveLocale.js` balíčku
 * next-intl 4.13.4, funkce `resolveLocaleFromPrefix`). Databáze mezi zdroji
 * není, cookie je tedy jediná cesta, jak dostat volbu uživatele nad nastavení
 * jeho prohlížeče.
 *
 * Zapisovat ji smí jen Server Action nebo Route Handler, ze Server Component
 * to Next.js nedovolí. Proto to dělají akce přihlášení, průvodce a uložení
 * profilu, ne skořápka.
 */

/** Jméno vlastní `next-intl` (`localeCookie` v `receiveRoutingConfig`), nesmí se měnit. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Zapamatuje jazyk uživatele, aby přebil hlavičku `accept-language`. */
export async function rememberLocale(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: LOCALE_COOKIE_MAX_AGE,
  });
}

/** Neznámá hodnota spadne na výchozí jazyk instalace, ne na chybu. */
export function localeOf(value: string): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

/** Jazyk, kterým právě mluví rozhraní. Používá se tam, kde se účet nezakládá. */
export async function currentLocale(): Promise<Locale> {
  const store = await cookies();
  return localeOf(store.get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE);
}
