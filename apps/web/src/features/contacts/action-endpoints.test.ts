import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Každá cesta, na kterou míří serverová akce kontaktů, musí v API existovat.
 *
 * Vzniklo to na dvou akcích, které volaly endpoint, jaký v API NIKDY nebyl:
 * `POST /contacts/{id}/unsubscribe` a `POST /suppressions/{id}/reveal`. Obojí se
 * v prohlížeči projevilo jako 404, tedy stejně jako chybějící hlavička
 * `X-Workspace-Id`, a proto se to při hledání nálezu I92 svedlo na ni. Doplnění
 * projektu ale s neexistující cestou nepomůže: 404 zůstane.
 *
 * Zdrojem pravdy je vygenerovaný kontrakt, ne seznam v tomhle souboru: ten by
 * zastaral přesně ve chvíli, kdy se API změní.
 */

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const CONTRACT = path.join(ROOT, 'packages/contracts/openapi.generated.json');
const ACTION_FILES = [
  'apps/web/src/features/contacts/actions.ts',
  'apps/web/src/features/contacts/edit-actions.ts',
];

/**
 * ZNÁMÁ DÍRA, KTEROU TENHLE TEST HLÍDÁ, ABY SE NEZTRATILA.
 *
 * `POST /suppressions/{id}/reveal` plán P07 popisuje („Celou adresu vrací samostatný
 * endpoint a jeho volání se zapisuje do auditu"), ale v API NENÍ: `suppressions.routes.ts`
 * zná jen výpis, přidání a odebrání. Tlačítko „Zobrazit celou adresu" na obrazovce
 * blokovaných adres proto nic neudělá.
 *
 * Doplnit ho není jednořádková oprava: audit má v části 1 uzavřenou tabulku 3.7
 * s dvaceti šesti akcemi a `suppression.revealed` mezi nimi není, takže by k tomu
 * patřilo rozhodnutí o rozšíření té tabulky včetně obou jazyků. Patří to do vlastního
 * úkolu, ne do opravy hlavičky projektu. Až endpoint vznikne, tenhle výčet se smaže
 * a test zezelená sám.
 */
const KNOWN_MISSING = new Set(['/api/v1/suppressions/{param}/reveal']);

/** `/api/v1/lists/{id}/subscribe` a `` `/api/v1/lists/${x}/subscribe` `` na týž tvar. */
function toTemplate(value: string): string {
  return value
    .split('?')[0]!
    .replace(/\$\{[^}]+\}/g, '{param}')
    .replace(/\{[^}]+\}/g, '{param}');
}

function contractPaths(): Set<string> {
  const parsed: unknown = JSON.parse(readFileSync(CONTRACT, 'utf8'));
  const paths = (parsed as { paths: Record<string, unknown> }).paths;
  return new Set(Object.keys(paths).map(toTemplate));
}

/** Cesty z volání `apiMutate` a `apiFetch`, včetně těch skládaných šablonou. */
function usedPaths(file: string): string[] {
  const source = readFileSync(path.join(ROOT, file), 'utf8');
  const found: string[] = [];
  for (const match of source.matchAll(/api(?:Mutate|Fetch)<[^>]*>\(\s*[`']([^`']+)[`']/g)) {
    found.push(toTemplate(match[1]!));
  }
  return found;
}

describe('serverové akce kontaktů volají jen existující endpointy', () => {
  const known = contractPaths();

  it('kontrakt se načetl a není prázdný', () => {
    expect(known.size).toBeGreaterThan(100);
  });

  it('výjimka platí jen do doby, než endpoint vznikne', () => {
    // Kdyby výjimka přežila endpoint, mlčky by dovolila i příští překlep ve stejné cestě.
    for (const candidate of KNOWN_MISSING) {
      expect(known.has(candidate), `${candidate} už v API je, smaž ho z KNOWN_MISSING`).toBe(false);
    }
  });

  it('výjimka se opravdu používá, tedy popisuje živý problém', () => {
    const used = new Set(ACTION_FILES.flatMap(usedPaths));
    for (const candidate of KNOWN_MISSING) {
      expect(
        used.has(candidate),
        `${candidate} už žádná akce nevolá, smaž ho z KNOWN_MISSING`,
      ).toBe(true);
    }
  });

  for (const file of ACTION_FILES) {
    it(`${file} nemíří na neexistující cestu`, () => {
      const used = usedPaths(file);
      expect(used.length, `v ${file} se nenašlo žádné volání API`).toBeGreaterThan(0);
      const missing = used.filter(
        (candidate) => !known.has(candidate) && !KNOWN_MISSING.has(candidate),
      );
      expect(missing, `tyhle cesty v openapi.generated.json nejsou: ${missing.join(', ')}`).toEqual(
        [],
      );
    });
  }
});
