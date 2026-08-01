import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(import.meta.dirname, '../..');

/** Všechny testovací soubory, které tenhle plán zakládá pod `src/`. */
function editorTestFiles(dir: string): string[] {
  let found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found = found.concat(editorTestFiles(full));
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(path.relative(webRoot, full));
  }
  return found;
}

/** Escapuje znaky, které mají v regulárním výrazu vlastní význam. */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Převod glob vzoru Vitestu na regulární výraz. Stačí na `**`, `*` a `{a,b}`,
 * což jsou jediné konstrukce, které se v `include` vyskytují.
 *
 * Jde znak po znaku schválně. Varianta složená z postupných `replace` potřebuje
 * zástupný znak, kterým se `**` odloží stranou, aby ho nesežral následující
 * převod `*`; takový znak se musí volit tak, aby se nemohl objevit ve vstupu,
 * a je to zbytečná past. Tahle podoba žádný zástupný znak nemá.
 */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const rest = pattern.slice(i);
    if (rest.startsWith('**/')) {
      source += '(?:[^/]+/)*';
      i += 2;
      continue;
    }
    if (rest.startsWith('*')) {
      source += '[^/]*';
      continue;
    }
    if (rest.startsWith('{')) {
      const close = pattern.indexOf('}', i);
      const options = pattern
        .slice(i + 1, close)
        .split(',')
        .map(escapeLiteral);
      source += `(?:${options.join('|')})`;
      i = close;
      continue;
    }
    source += escapeLiteral(rest[0] as string);
  }
  return new RegExp(`^${source}$`);
}

type VitestConfigShape = {
  plugins?: unknown[];
  test?: { include?: string[]; environment?: string; setupFiles?: string[] };
};

async function loadConfig(): Promise<VitestConfigShape> {
  return (await import('../../vitest.config.js')).default as VitestConfigShape;
}

describe('konfigurace testů apps/web unese testy P12', () => {
  it('vzor include pokrývá každý testovací soubor editoru', async () => {
    const config = await loadConfig();
    const include: string[] = config.test?.include ?? [];
    const patterns = include.map(globToRegExp);
    const editorDir = path.join(webRoot, 'src/features/editor');
    const files = editorTestFiles(editorDir);

    // Prázdný seznam by test proměnil v ozdobu: prošel by, i kdyby include byl prázdný.
    expect(
      files.length,
      'pod src/features/editor nejsou žádné testy, něco je špatně',
    ).toBeGreaterThan(0);

    const nepokryte = files.filter((file) => !patterns.some((pattern) => pattern.test(file)));
    expect(
      nepokryte,
      `mimo include: ${nepokryte.join(', ')}. Bez nich série skončí zeleně a nulou, aniž se cokoli spustilo.`,
    ).toEqual([]);
  });

  it('běží v jsdom a má plugin React, jinak render() nemá kde renderovat', async () => {
    const config = await loadConfig();
    expect(config.test?.environment).toBe('jsdom');
    expect(config.plugins?.length ?? 0).toBeGreaterThan(0);
  });

  it('setupFiles registruje úklid po každém testu', async () => {
    const config = await loadConfig();
    const setupFiles: string[] = config.test?.setupFiles ?? [];
    expect(
      setupFiles.length,
      'bez setupFiles zůstane render z předchozího testu v dokumentu',
    ).toBeGreaterThan(0);
    // Prázdný setup je stejná vada jako žádný. Automatický úklid
    // @testing-library/react se registruje jen při globals: true, a bez
    // cleanup() padne každý druhý render na „Found multiple elements with
    // the role". Vypadalo by to jako chyba testu, ne konfigurace.
    const setup = readFileSync(path.join(webRoot, 'vitest.setup.ts'), 'utf8');
    expect(setup).toContain('cleanup');
    expect(setup).toContain('afterEach');
  });
});
