import { Liquid } from 'liquidjs';
import { HTML_ESCAPE_MAP } from './grammar';
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
    ...(escapeOutput ? { outputEscape: (value: unknown) => htmlEscape(value) } : {}),
  });

  for (const name of listBuiltinFilterNames()) {
    engine.registerFilter(name, () => {
      throw new Error(`filtr ${name} není v kontraktu 4.10.2`);
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
