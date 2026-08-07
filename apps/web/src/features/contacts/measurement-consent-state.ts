/**
 * Stav souhlasu s měřením chování, jak ho čte rozhraní.
 *
 * Vlastní soubor bez `'use client'` a bez importu Reactu, aby si ho mohla vzít
 * i serverová stránka. Kdyby typ i převod bydlely v kartě, musela by stránka
 * kvůli jedné funkci natáhnout klientskou komponentu.
 *
 * TŘI HODNOTY. `not_recorded` znamená, že se ten člověk k měření nikdy
 * nevyjádřil. Není to souhlas ani odmítnutí a obrazovka to z něj nesmí udělat.
 *
 * Odpovídá `MeasurementConsent` v `packages/core/src/contacts/repo/consents.ts`.
 * Rozhraní si sem NEKOPÍRUJE pravidlo, jen tvar: o tom, jestli se smí měřit,
 * rozhoduje server (`allowsMeasurement`), tady se stav jen ukazuje.
 */
export type MeasurementConsent = 'granted' | 'withdrawn' | 'not_recorded';

/**
 * Převod hodnoty z `GET /contacts/{id}`. Endpoint vrací pole `consents` se
 * stavem každého účelu; chybějící položka pro `analytics` znamená, že o měření
 * nikdo nic neřekl.
 */
export function toMeasurementConsent(status: string | null | undefined): MeasurementConsent {
  if (status === 'withdrawn') return 'withdrawn';
  if (status === 'granted') return 'granted';
  return 'not_recorded';
}
