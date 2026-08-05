/**
 * JSON Canonicalization Scheme, RFC 8785. Závazně a jmenovitě, bez vlastní varianty.
 *
 * Viz plán P10 Task 28 a specifikace 3.6.3. Podpis `identify` vyrábí server
 * zákazníka VE SVÉM JAZYCE (PHP, Python, Ruby, Go) a ověřuje ho náš Node.
 * Kanonizace JSONu je klasické místo, kde se dvě implementace rozejdou
 * na drobnosti, kterou nikdo nevidí, a výsledek je „podpis nesedí" bez jediné
 * stopy, kde. RFC 8785 určuje jednoznačně ty čtyři věci, na kterých se
 * implementace rozcházejí: klíče se řadí podle UTF-16 code unitů, čísla podle
 * ECMAScript Number::toString, řetězce se escapují minimálně, mezi tokeny
 * nejsou mezery.
 *
 * Píšeme si ji sami, asi sedmdesát řádků, protože máme závazný testovací
 * vektor, proti kterému se vlastní implementace ověří líp než cizí, a licenční
 * jistota je u vlastního kódu vyšší.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('RFC 8785 nedovoluje NaN ani Infinity');
      }
      // String(1.0) je "1", String(1490.5) je "1490.5", což RFC vyžaduje.
      return String(value);
    case 'string':
      return serializeString(value);
    case 'object':
      break;
    default:
      throw new Error(`Hodnota typu ${typeof value} se nedá kanonizovat`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  // Řazení podle UTF-16 code unitů. Výchozí porovnání řetězců v JavaScriptu
  // přesně tohle dělá, localeCompare by dalo jiné pořadí a rozešlo by se.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${serializeString(k)}:${canonicalize(v)}`).join(',')}}`;
}

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
});

function serializeString(value: string): string {
  let out = '"';
  for (const char of value) {
    const escape = ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    // Všechno ostatní včetně diakritiky jde jako surové UTF-8, neescapuje se.
    out += char;
  }
  return `${out}"`;
}
