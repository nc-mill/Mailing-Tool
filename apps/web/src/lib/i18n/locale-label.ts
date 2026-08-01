/**
 * Jméno jazyka se nikdy neskládá ručně ani nedrží v mapě `{ cs: 'Čeština' }`
 * (pravidlo 12.4: formátování vždy přes `Intl`). Mapa by navíc znamenala, že
 * přidání jazyka vyžaduje zásah do kódu na třech místech.
 */
export function localeLabel(code: string, uiLocale: string): string {
  return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code;
}
