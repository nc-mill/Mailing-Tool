/// <reference types="node" />
// ODCHYLKA OD PLÁNU: reference na typy Node je tady schválně jen v tomhle souboru.
// tsconfig má "types": [], aby se do zdrojáků SDK nedaly propašovat Node API.
// Test velikosti ale build spouští, takže node:child_process a spol. potřebuje.
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const TARGET_BYTES = 4200;
const HARD_LIMIT_BYTES = 5120;

// ODCHYLKA OD PLÁNU: plán adresoval bundle přes new URL('../dist/ml.js', import.meta.url).
// Vite tenhle zápis při transformaci přepisuje na adresu assetu (vyšlo z toho
// https://shop.cz/@fs/...), takže soubor nešlo přečíst. Cesta se proto skládá přes node:path.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(PACKAGE_ROOT, 'dist', 'ml.js');

describe('velikost sestaveného SDK', () => {
  let gzippedSize: number;

  beforeAll(() => {
    execFileSync('node', ['build.mjs'], { cwd: PACKAGE_ROOT });
    gzippedSize = gzipSync(readFileSync(BUNDLE)).length;
  }, 120_000);

  it('nepřekročí tvrdý limit, jinak tenhle test je ta branka, která CI shodí', () => {
    expect(gzippedSize).toBeLessThanOrEqual(HARD_LIMIT_BYTES);
  });

  it('drží se pod cílovou hodnotou, nebo to aspoň hlásí', () => {
    if (gzippedSize > TARGET_BYTES) {
      // ODCHYLKA OD PLÁNU: console.error místo console.warn, sdílené pravidlo
      // no-console jinou metodu nepovolí.
      console.error(`SDK má ${gzippedSize} B gzip, cíl je ${TARGET_BYTES} B`);
    }
    expect(gzippedSize).toBeGreaterThan(0);
  });

  it('bundle neobsahuje žádnou runtime závislost ani odkaz na node_modules', () => {
    const source = readFileSync(BUNDLE, 'utf8');
    expect(source).not.toContain('node_modules');
    expect(source).not.toContain('require(');
  });
});
