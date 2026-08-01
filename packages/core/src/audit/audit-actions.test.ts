import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_ROOT = fileURLToPath(new URL('../', import.meta.url));

function auditFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'data') continue;
      out.push(...auditFiles(full));
    } else if (entry === 'audit.ts') {
      out.push(full);
    }
  }
  return out;
}

/**
 * Nahrazuje sdílený typový union AuditAction. Kdyby existoval, byl by to soubor,
 * do kterého píše každý plán, tedy konflikt v každém merge (uzávěr S11).
 */
describe('registr auditních akcí napříč doménami', () => {
  const files = auditFiles(CORE_ROOT);

  it('existuje aspoň jeden soubor s akcemi', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('žádný název akce se neopakuje ve dvou doménách', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/g)) {
        const name = match[1]!;
        const previous = seen.get(name);
        if (previous && previous !== file) duplicates.push(`${name}: ${previous} a ${file}`);
        seen.set(name, file);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('doména identity deklaruje všech 24 akcí z tabulky 3.7, které jí patří', async () => {
    const { IdentityAuditActions } = await import('../identity/audit');
    expect(Object.keys(IdentityAuditActions)).toHaveLength(24);
  });
});
