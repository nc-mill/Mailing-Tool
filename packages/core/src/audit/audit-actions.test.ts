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

  /**
   * Počet je 26, ne 24 z tabulky 3.7, a je to ZÁMĚR, ne rozvolnění brány.
   *
   * Dvě akce přibyly nad rámec původní tabulky: `member.created` (založení
   * člena rovnou s heslem, bez pozvánky e-mailem) a `user.deleted` (smazání
   * účtu bez projektu). Obojí jsou skutečné operace v rozhraní a bez záznamu
   * v auditu by po nich nezůstala stopa, což je u zásahu do cizího přístupu
   * nepřijatelné.
   *
   * Test drží PŘESNÝ počet schválně, ne „aspoň tolik": nová auditní akce je
   * rozhodnutí, ne detail, a má o ní vědět ten, kdo mění tenhle výčet. Kdo
   * sem akci přidá, upraví číslo a napíše sem proč.
   */
  it('doména identity deklaruje všech 26 akcí, které jí patří', async () => {
    const { IdentityAuditActions } = await import('../identity/audit');
    expect(Object.keys(IdentityAuditActions)).toHaveLength(26);
  });
});
