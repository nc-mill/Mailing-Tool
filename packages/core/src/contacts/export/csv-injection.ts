const DANGEROUS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Buňka začínající na některý z těchhle znaků se prefixuje apostrofem.
 * Bez toho je export cesta, jak přes kontakt jménem =cmd|'/c calc'!A1
 * spustit kód v tabulkovém procesoru příjemce. Platí i pro errors.csv
 * a pro GDPR export.
 */
export function guardCsvCell(value: string): string {
  return DANGEROUS.some((ch) => value.startsWith(ch)) ? `'${value}` : value;
}
