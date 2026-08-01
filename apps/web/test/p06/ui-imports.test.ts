import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = path.resolve(import.meta.dirname, '../../src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Povolené tvary podle mapy `exports` v `packages/ui/package.json`. */
const ALLOWED = [
  /^@mlain\/ui\/components\/[a-z0-9-]+$/,
  /^@mlain\/ui\/patterns\/[a-z0-9-]+$/,
  /^@mlain\/ui\/lib\/[a-z0-9-]+$/,
  /^@mlain\/ui\/(theme|a11y|tokens\.css|globals\.css)$/,
];

describe('importy z @mlain/ui', () => {
  it('žádný import nemíří na kořen balíčku ani hlouběji než na adresář vzoru', () => {
    const bad: string[] = [];
    for (const file of sourceFiles(WEB_SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from '(@mlain\/ui[^']*)'/g)) {
        const specifier = match[1]!;
        if (!ALLOWED.some((pattern) => pattern.test(specifier))) {
          bad.push(`${path.relative(WEB_SRC, file)}: ${specifier}`);
        }
      }
    }
    // Kořenový import skončí ERR_PACKAGE_PATH_NOT_EXPORTED, import na úroveň
    // souboru se hledá jako adresář s index.ts a neexistuje. Obojí je chyba
    // sestavení, ale až v okamžiku, kdy se soubor poprvé načte.
    expect(bad).toEqual([]);
  });
});
