import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

// Nejtišší způsob, jak tenhle plán selhat, je proběhnout se zelenými kroky,
// ve kterých se nespustil ani jeden test.
//
// Soubor apps/web/vitest.config.ts vlastní P01 a jeho původní znění mělo
// prostředí node a vzor pokrývající jen adresář test. Testy komponent P06 leží
// vedle zdrojů v adresáři src, tedy mimo ten vzor. Vitest je nenajde,
// kompletní série vypíše „1 passed" a skončí kódem 0. Ověřeno spuštěním.
//
// Tenhle soubor leží v adresáři test, tedy uvnitř STARÉHO vzoru schválně:
// spustí se i tehdy, když se nespustí nic jiného, a je to jediné místo,
// kde se dá tichý úspěch zachytit zevnitř.
//
// Když spadne, NEOPRAVUJ to tady. Konfigurace patří P01 a požadavek na ni
// je P06→P01.1 v kapitole 2.4.
const WEB_ROOT = path.resolve(import.meta.dirname, '../..');

function testFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...testFilesUnder(full));
    } else if (/\.test\.tsx?$/.test(entry)) {
      out.push(path.relative(WEB_ROOT, full));
    }
  }
  return out;
}

const include = (config as { test?: { include?: string[] } }).test?.include ?? [];
const environment = (config as { test?: { environment?: string } }).test?.environment;
const setupFiles = (config as { test?: { setupFiles?: string[] } }).test?.setupFiles ?? [];
const plugins = (config as { plugins?: unknown[] }).plugins ?? [];

describe('testovací běh apps/web pokrývá testy P06', () => {
  it('každý testovací soubor pod src/ padne do některého vzoru include', () => {
    const isMatch = picomatch(include);
    const missed = testFilesUnder(path.join(WEB_ROOT, 'src')).filter((file) => !isMatch(file));
    expect(missed, `mimo vzor include (${include.join(', ')})`).toEqual([]);
  });

  it('prostředí je jsdom, jinak render() nemá kam vykreslit', () => {
    expect(environment).toBe('jsdom');
  });

  it('je zapojený plugin React, jinak se .tsx nepřeloží', () => {
    expect(plugins.length).toBeGreaterThan(0);
  });

  it('setupFiles registruje úklid mezi testy', () => {
    expect(setupFiles.length).toBeGreaterThan(0);
    const setup = setupFiles
      .map((file) => readFileSync(path.resolve(WEB_ROOT, file), 'utf8'))
      .join('\n');
    // Bez úklidu zůstane strom z předchozího testu v dokumentu a
    // screen.getByRole najde dva prvky. Ověřeno spuštěním.
    expect(setup).toMatch(/cleanup/);
  });
});
