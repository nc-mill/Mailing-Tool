import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOMAIN_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Zkrácení keyringu a nerotovatelný klíč jsou dvě podoby téže tiché poruchy: vymazaný
 * člověk se vrátí prvním dalším importem a nic o tom nebude vědět, protože otisk
 * suppression řádku nejde přepočítat.
 *
 * Plán na to chce pravidlo ESLintu. Konfiguraci ESLintu vlastní P01, takže blok pravidel
 * leží připravený v `eslint-rules.js` a tenhle test hlídá totéž ve chvíli, kdy běží sada.
 * Ptá se na tvar zdrojáku, `fingerprint.test.ts` se ptá na chování; obejít se musí obojí.
 */
const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /\.values\(\)\s*\]\s*\.(slice|splice)\(/,
    why: 'zkrácení keyringu přes [...keyring.values()].slice(...)',
  },
  {
    pattern: /\.keys\(\)\s*\)\s*\.(slice|splice)\(/,
    why: 'zkrácení keyringu přes Array.from(keyring.keys()).slice(...)',
  },
  {
    pattern: /\.values\(\)\s*\)\s*\.(slice|splice)\(/,
    why: 'zkrácení keyringu přes Array.from(keyring.values()).slice(...)',
  },
  {
    pattern: /SUPPRESSION_HASH_KEY/,
    why: 'nerotovatelný klíč SUPPRESSION_HASH_KEY',
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'data') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    // Dva soubory ty tvary obsahují jako vzorky, ne jako kód: tenhle test a definice
    // pravidel pro ESLint. Kdyby se nevynechaly, hlásil by test sám sebe.
    if (entry === 'keyring-guard.test.ts' || entry === 'eslint-rules.js') continue;
    if (entry.endsWith('.ts') || entry.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('ochrana proti zkrácení keyringu', () => {
  it('pravidlo skutečně chytá to, co má chytat', () => {
    // Pravidlo, které nikdy nespadlo, není ověřené pravidlo. Tenhle případ je
    // náhradou za dočasný soubor s porušením z kroku 7 plánu.
    const violations = [
      'const x = [...keyring.values()].slice(0, 5);',
      'const y = Array.from(keyring.keys()).slice(0, 6);',
      'const z = Array.from(keyring.values()).splice(0, 6);',
      'const k = process.env.SUPPRESSION_HASH_KEY;',
    ];
    for (const line of violations) {
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(line)),
        line,
      ).toBe(true);
    }
  });

  it('legitimní průchod přes všechna pokolení pravidlo nechytá', () => {
    const allowed = [
      'return [...keyring.values()].map((master) => fingerprintWith(master, email));',
      'const keyId = currentKeyId(keyring);',
    ];
    for (const line of allowed) {
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(line)),
        line,
      ).toBe(false);
    }
  });

  it('žádný soubor domény keyring nezkracuje', () => {
    const found: string[] = [];
    for (const file of sourceFiles(DOMAIN_ROOT)) {
      const src = readFileSync(file, 'utf8');
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(src)) found.push(`${file}: ${why}`);
      }
    }
    expect(found).toEqual([]);
  });
});
