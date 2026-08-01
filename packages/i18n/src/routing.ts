import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locales';

/**
 * Cesta má tvar `/{locale?}/w/{workspace_slug}/{sekce}`.
 * `as-needed` znamená, že výchozí jazyk je bez prefixu (konvence části 1, 3.9).
 */
export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
});
