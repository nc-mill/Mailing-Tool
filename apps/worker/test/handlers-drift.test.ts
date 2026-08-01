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
});
