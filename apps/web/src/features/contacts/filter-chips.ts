'use client';

import { useTranslations } from 'next-intl';
import { describeFilters, type ContactListFilters, type FilterNames } from './filters';

/**
 * Přeložené části popisu filtru. `describeFilters` vrací klíče relativní k `filters.*`
 * (`chip.list`), protože je to čistá funkce bez katalogu; prefix se doplňuje až tady.
 *
 * Věta se nikdy neskládá z fragmentů (pravidlo 12.2 části 6): každá část je celá
 * zpráva s vlastním klíčem a spojí je až `Intl.ListFormat` u volajícího.
 */
export function useFilterChips(): (filters: ContactListFilters, names: FilterNames) => string[] {
  const t = useTranslations('contacts');

  return (filters, names) =>
    describeFilters(filters, names).map((chip) => {
      const value = chip.values['value'];
      // Stav je překladový klíč, ne holé anglické slovo. Přeloží se dřív, než se
      // dosadí do zprávy o filtru.
      const resolved = value?.startsWith('status.') ? t(value) : value;
      return t(`filters.${chip.key}`, resolved === undefined ? {} : { value: resolved });
    });
}
