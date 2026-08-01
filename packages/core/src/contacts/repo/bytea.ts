/**
 * Textový literál pole `bytea` pro parametr dotazu.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ POSTGRESQL. Plán posílal otisky jako `bytea[][]` a rozbaloval
 * je přes `unnest`. Ani jedno nefunguje: `unnest` nad dvourozměrným polem ho ZPLOŠTÍ celé,
 * takže by se otisky slily přes hranice řádků, a literál `{{},{}}` s prázdným vnitřním polem
 * PostgreSQL vůbec nepřijme, takže by dávka s jediným kontaktem bez otisků spadla.
 *
 * Posílá se proto `text[]`, kde každý prvek je hotový literál pole `bytea` pro jeden řádek,
 * a přetypování na `bytea[]` se dělá až uvnitř dotazu.
 *
 * Escapování: hodnota prvku má být `\x0a0b`. V literálu pole se uvnitř uvozovek jeden
 * zpětný lomítko zapisuje dvěma, takže výsledný text je `{"\\x0a0b"}`.
 */
export function byteaArrayLiteral(values: readonly Uint8Array[]): string {
  if (values.length === 0) return '{}';
  const items = values.map((value) => `"\\\\x${Buffer.from(value).toString('hex')}"`);
  return `{${items.join(',')}}`;
}
