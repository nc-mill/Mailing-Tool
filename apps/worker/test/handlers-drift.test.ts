import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

describe('handlers.generated.ts', () => {
  it('se shoduje s výstupem codegenu (uzávěr S8, rozhodnutí D4)', () => {
    const file = path.join(ROOT, 'apps/worker/src/handlers.generated.ts');
    const committed = fs.readFileSync(file, 'utf8');
    const regenerated = execFileSync(
      process.execPath,
      [path.join(ROOT, 'apps/worker/codegen.mjs'), '--stdout'],
      { encoding: 'utf8' },
    );
    expect(committed).toBe(regenerated);
  });

  it('nese poznámku, že se soubor nikdy neslučuje ručně', () => {
    const file = path.join(ROOT, 'apps/worker/src/handlers.generated.ts');
    expect(fs.readFileSync(file, 'utf8')).toContain('nikdy neslučuje ručně');
  });

  /**
   * Doména, která má rejstřík na první i na druhé úrovni, musí být v generovaném
   * souboru CELÁ.
   *
   * Codegen dřív po nálezu `contacts/jobs/queue-handlers.ts` přeskočil zbytek
   * adresáře, takže `contacts/export/jobs` a `contacts/import/jobs` z mapy tiše
   * vypadly. Nic by nespadlo: fronty by se dál zakládaly, jen by import kontaktů
   * nikdy neskončil. Test je tady proto, že se ta vada v tomhle repozitáři
   * v přesně téhle podobě už jednou stala.
   */
  it('obsahuje rejstřík z první i druhé úrovně téže domény', () => {
    const generated = fs.readFileSync(
      path.join(ROOT, 'apps/worker/src/handlers.generated.ts'),
      'utf8',
    );
    for (const module of [
      '@mlain/core/contacts/jobs',
      '@mlain/core/contacts/export/jobs',
      '@mlain/core/contacts/import/jobs',
    ]) {
      expect(generated, `codegen zapomněl na ${module}`).toContain(`from '${module}';`);
    }
  });
});
