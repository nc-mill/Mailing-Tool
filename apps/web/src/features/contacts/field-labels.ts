/**
 * PŘEJMENOVÁNÍ VLASTNÍHO POLE: co poslat do `label`.
 *
 * Popisek pole je otevřená mapa jazyků s POVINNÝM klíčem `en` (`LocalizedText`
 * ve 4.2.3 části 2). Obrazovka přitom nabízí jedno pole na text, protože
 * dvojjazyčné popisky jsou vlastní úkol; kdyby se odesílalo jen to, co člověk
 * napsal, přepsala by čeština anglický popisek nastavený přes API a naopak.
 *
 * Proto se posílá CELÁ dosavadní mapa a přepíše se v ní jen jazyk rozhraní.
 * Chybějící `en` se doplní touž hodnotou, jinak by zápis skončil na 422
 * `required_field_missing` a uživatel by u přejmenování dostal chybu, které
 * nemůže rozumět.
 *
 * Je to čistá funkce, aby šlo tohle pravidlo otestovat bez vykreslení dialogu.
 */
export function nextFieldLabels(
  current: Record<string, string>,
  locale: string,
  value: string,
): Record<string, string> {
  const next = { ...current, [locale]: value };
  if (typeof next['en'] !== 'string' || next['en'].length === 0) next['en'] = value;
  return next;
}
