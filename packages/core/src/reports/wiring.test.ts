import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../../..');

/**
 * Tenhle soubor nepřidává funkci. Odpovídá na otázku, kterou zelené jednotkové
 * testy nikdy nepoloží: KDO TU FUNKCI VOLÁ V PRODUKCI?
 *
 * Vzor je převzatý z `src/ai/wiring.test.ts`, protože jde o tutéž třídu vady:
 * `metricDisplay` měla vlastní test se čtyřmi zelenými případy a nikdo ji
 * nevolal, takže obrazovka reportu si pravidla dopočítávala sama a u vypnutého
 * měření vykreslovala nulu (nález I71).
 *
 * Kdyby tenhle test spadl, NEUPRAVUJ HO. Znamená to, že chybí zapojení.
 */
function productionUses(symbol: string, excludeFile: string): string[] {
  let out = '';
  try {
    out = execFileSync(
      'grep',
      ['-rn', '--include=*.ts', '--include=*.tsx', symbol, 'packages/core/src', 'apps/web/src'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter((line) => line !== '')
    .filter((line) => !line.includes('.test.'))
    .filter((line) => !line.includes('__tests__'))
    .filter((line) => !line.startsWith(excludeFile) && !line.includes(`/${excludeFile}:`))
    .filter(isCode)
    .filter(isNotBarrelReexport);
}

/** Reexport z barelu není volání, jen propíchnutí symbolu skrz. */
function isNotBarrelReexport(line: string): boolean {
  const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
  return !/^export\s+(type\s+)?\{[^}]*\}\s+from\s+/.test(code);
}

/** Komentář o funkci není její volání. */
function isCode(line: string): boolean {
  const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
  return !code.startsWith('*') && !code.startsWith('//') && !code.startsWith('/*');
}

describe('pravidla zobrazení metrik jsou zapojená, ne jen napsaná', () => {
  it('metricDisplay má produkčního volajícího mimo vlastní soubor', () => {
    const uses = productionUses('metricDisplay(', 'packages/core/src/reports/metrics/display.ts');
    expect(
      uses.length,
      `metricDisplay nikdo nevolá, vypnuté měření tedy zase vypadá jako nula:\n${uses.join('\n')}`,
    ).toBeGreaterThan(0);
    expect(
      uses.some((line) => line.includes('features/reports/report/report-model.ts')),
      'model reportu si pravidla dopočítává sám místo jádra',
    ).toBe(true);
  });

  /**
   * Druhá polovina téhož: kdyby model `metricDisplay` volal, ale komponenta
   * jeho výsledek ignorovala a formátovala si čísla po svém, byl by test výš
   * zelený a obrazovka pořád špatně. Proto se hlídá i spotřebitel.
   */
  it('dlaždice reportu rozhodují podle výsledku metricDisplay', () => {
    const uses = productionUses('display.kind', 'packages/core/src/reports/metrics/display.ts');
    expect(
      uses.some((line) => line.includes('features/reports/report/headline-tiles.tsx')),
      'hlavní dlaždice ignorují rozhodnutí metricDisplay',
    ).toBe(true);
    expect(
      uses.some((line) => line.includes('features/reports/report/opens-panel.tsx')),
      'panel otevření ignoruje rozhodnutí metricDisplay',
    ).toBe(true);
  });
});
