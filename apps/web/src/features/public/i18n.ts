import { isSupportedLocale, type Locale } from '@mlain/i18n/locales';
import { loadMessages } from '@mlain/i18n/load-messages';
import { createTranslator } from 'next-intl';

/**
 * Překladač veřejných stránek.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ TÍM, ŽE JSOU STRÁNKY ROUTE HANDLERY. Plán volal
 * `getTranslations({ locale, namespace })` z `next-intl/server`. Ta funkce čte jazyk
 * z požadavku přes `getRequestConfig`, tedy z prostředí, které route handler mimo
 * segment `[locale]` nemá. `createTranslator` bere zprávy jako obyčejný objekt,
 * takže je pro tenhle povrch přesnější: jazyk se předává výslovně a nikdy se nevezme
 * z hlavičky prohlížeče, což je požadavek kapitoly 8.9 části 6.
 */
export type PublicTranslator = (key: string, values?: Record<string, string | number>) => string;

const cache = new Map<Locale, Awaited<ReturnType<typeof loadMessages>>>();

/** Jazyk kontaktu nemusí být jazyk aplikace. Nepodporovaný spadne na češtinu. */
export function resolvePublicLocale(raw: string | null | undefined): Locale {
  if (raw === null || raw === undefined) return 'cs';
  const base = raw.split('-')[0] ?? raw;
  return isSupportedLocale(base) ? base : 'cs';
}

export async function publicTranslator(
  locale: string,
  namespace: string,
): Promise<PublicTranslator> {
  const resolved = resolvePublicLocale(locale);
  let messages = cache.get(resolved);
  if (messages === undefined) {
    messages = await loadMessages(resolved);
    cache.set(resolved, messages);
  }
  const translator = createTranslator({ locale: resolved, messages, namespace });
  return (key, values) =>
    // Typy next-intl jsou psané pro katalog známý v době překladu; veřejné stránky
    // klíč skládají za běhu, takže se překladač volá dynamicky.
    (translator as unknown as (k: string, v?: Record<string, unknown>) => string)(key, values);
}
