import { Liquid } from 'liquidjs';
import { ALLOWED_TAGS, HTML_ESCAPE_MAP } from './grammar';
import { dateFilter, defaultFilter, escapeFilter, simpleDowncase, simpleUpcase } from './filters';

/**
 * Povinná konfigurace knihovny (bez ní kontrakt neplatí):
 *  - jsTruthy: false, se zapnutým by se pravdivost rozešla s Go
 *  - strictFilters: true, neznámý filtr má být chyba
 *  - strictVariables: false, neznámá proměnná má být prázdný řetězec
 *
 * Vestavěné filtry konstruktor registruje vždy a odregistrovat je neumí, takže
 * se přepisují funkcí, která vyhodí chybu. Závazný je behaviorální test, ne
 * introspekce registru.
 */
export function listBuiltinFilterNames(): string[] {
  // V LiquidJS 10.27.2 je `engine.filters` přímo mapa jméno -> implementace
  // (objekt bez prototypu), ne obálka s polem `impls`. Plán počítal s druhým
  // tvarem, ověřeno spuštěním: `impls` v téhle verzi neexistuje. Čte se proto
  // obojí a dolní mez na počtu drží dál, takže tichá díra vzniknout nemůže.
  const probe = new Liquid() as unknown as {
    filters: Record<string, unknown> & { impls?: Record<string, unknown> };
  };
  const registry = probe.filters.impls ?? probe.filters;
  const names = Object.keys(registry);
  if (names.length < 30) {
    throw new Error(
      `LiquidJS vrátila jen ${names.length} vestavěných filtrů; vnitřní API se změnilo a přepsání ` +
        'vestavěných filtrů se musí udělat jinak, jinak vznikne tichá díra v kontraktu',
    );
  }
  return names;
}

/**
 * Jména vestavěných TAGŮ knihovny. Protějšek `listBuiltinFilterNames`, a vznikl
 * ze stejné příčiny, jen o rok bolestivější: konstruktor registruje 21 tagů
 * a odregistrovat je neumí, takže se stejně jako filtry přepisují.
 *
 * DO 8. 8. 2026 SE NEPŘEPISOVALY. Kontrakt uzavřel filtry a na tagy zapomněl,
 * takže `{% render 'package.json' %}` vrátilo obsah souboru; ověřeno spuštěním,
 * nález N1. Průchod nad kořen liquidjs blokuje, ale všechno pod pracovním
 * adresářem procesu se přečetlo, a předmět kampaně jde do renderu bez validace.
 *
 * Dolní mez na počtu drží ze stejného důvodu jako u filtrů: kdyby se vnitřní
 * API změnilo a `tags` byla najednou prázdná, vznikla by tichá díra místo chyby.
 */
export function listBuiltinTagNames(): string[] {
  const probe = new Liquid() as unknown as { tags: Record<string, unknown> };
  const names = Object.keys(probe.tags ?? {});
  if (names.length < 15) {
    throw new Error(
      `LiquidJS vrátila jen ${names.length} vestavěných tagů; vnitřní API se změnilo a přepsání ` +
        'vestavěných tagů se musí udělat jinak, jinak vznikne tichá díra v kontraktu',
    );
  }
  return names;
}

/**
 * Souborový systém, který nic nevrací.
 *
 * Druhá pojistka pod přepsáním tagů: kdyby budoucí verze knihovny přidala další
 * tag nad čtením souborů, nebo kdyby někdo přepsání obešel, dostane chybu místo
 * obsahu. Bez ní stačí jedna nová funkce v knihovně k tomu, aby díra byla zpět.
 */
const DENY_FS = {
  exists: async (): Promise<boolean> => false,
  existsSync: (): boolean => false,
  readFile: async (filepath: string): Promise<string> => {
    throw new Error(`čtení šablony ze souborového systému je zakázané (${filepath})`);
  },
  readFileSync: (filepath: string): string => {
    throw new Error(`čtení šablony ze souborového systému je zakázané (${filepath})`);
  },
  resolve: (_dir: string, file: string): string => file,
  contains: async (): Promise<boolean> => false,
  containsSync: (): boolean => false,
  sep: '/',
  dirname: (file: string): string => file,
};

function htmlEscape(value: unknown): string {
  // Chybějící proměnná je podle kontraktu prázdný řetězec. Bez téhle větve by
  // `String(undefined)` vypsalo do e-mailu slovo "undefined"; ověřeno spuštěním,
  // fixtures LQ-003 a LQ-004 na tom stály. Textový engine žádný outputEscape
  // nemá, takže se ho to netýká.
  if (value === null || value === undefined) return '';
  // `?? char` je jen kvůli noUncheckedIndexedAccess: regulární výraz sedne
  // právě na těch pět znaků, které mapa má, takže větev nikdy nenastane.
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function build(escapeOutput: boolean): Liquid {
  const engine = new Liquid({
    jsTruthy: false,
    strictFilters: true,
    strictVariables: false,
    fs: DENY_FS,
    ...(escapeOutput ? { outputEscape: (value: unknown) => htmlEscape(value) } : {}),
  });

  for (const name of listBuiltinFilterNames()) {
    engine.registerFilter(name, () => {
      throw new Error(`filtr ${name} není v kontraktu 4.10.2`);
    });
  }

  // Tagy mimo kontraktní seznam. Chyba padá už z `parse`, ne z `render`:
  // zakázaný tag má šablonu shodit bez ohledu na to, jestli se jeho větev
  // vůbec vykoná. Kdyby se házelo až z `render`, prošel by
  // `{% if false %}{% include "/etc/passwd" %}{% endif %}` mlčky a stačilo by
  // podmínku otočit. `else`, `elsif` a uzávěry v registru nejsou, ty si `if`,
  // `unless` a `for` parsují samy, takže se seznamu netýkají.
  const allowedTags = new Set<string>(ALLOWED_TAGS);
  for (const name of listBuiltinTagNames()) {
    if (allowedTags.has(name)) continue;
    engine.registerTag(name, {
      parse() {
        throw new Error(`tag ${name} není v kontraktu 4.10.2`);
      },
      render() {
        return '';
      },
    });
  }

  engine.registerFilter('default', (value: unknown, fallback = '') =>
    defaultFilter(value, String(fallback)),
  );
  engine.registerFilter('upcase', (value: unknown) => simpleUpcase(String(value ?? '')));
  engine.registerFilter('downcase', (value: unknown) => simpleDowncase(String(value ?? '')));
  engine.registerFilter('escape', (value: unknown) => escapeFilter(value));
  engine.registerFilter(
    'date',
    function (
      this: { context?: { getSync?: (path: string[]) => unknown } },
      value: unknown,
      format = '%d.%m.%Y',
    ) {
      const timezone = this?.context?.getSync?.(['_context', 'timezone']);
      return dateFilter(value, String(format), typeof timezone === 'string' ? timezone : undefined);
    },
  );

  return engine;
}

/** Dvě instance, ne jedna přepínaná za běhu. */
export const createHtmlEngine = (): Liquid => build(true);
export const createTextEngine = (): Liquid => build(false);
