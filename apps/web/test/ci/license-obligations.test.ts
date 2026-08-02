import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Kořen repozitáře se hledá vystoupáním od pracovního adresáře, ne z
 * `import.meta.url`. Plán tu má `new URL('../../../../', import.meta.url)`,
 * jenže `apps/web` má vitest v prostředí jsdom, kde `import.meta.url` NENÍ
 * adresa se schématem `file:` a `readFile` na ní skončí na
 * „TypeError: The URL must be of scheme file". Ověřeno spuštěním.
 */
function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Kořen repozitáře se nenašel.');
    dir = parent;
  }
}

const root = repoRoot();

describe('licenční povinnosti z licenses.allow.json', () => {
  it('každá výjimka s povinností má splněnou svou podmínku', async () => {
    const allow = JSON.parse(await readFile(join(root, 'licenses.allow.json'), 'utf8')) as {
      exceptions: { package: string; obligations?: string }[];
    };

    const withObligations = allow.exceptions.filter((e) => e.obligations);
    expect(withObligations.length).toBeGreaterThan(0);

    // Plný text licence musí existovat a být to opravdu on, ne zástupný soubor.
    const lgpl = await readFile(join(root, 'LICENSES', 'LGPL-3.0.txt'), 'utf8');
    expect(lgpl).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
    expect(lgpl.length).toBeGreaterThan(5000);

    // Postup výměny musí být konkrétní, tedy obsahovat spustitelný příkaz.
    const doc = await readFile(join(root, 'docs', 'operations', 'third-party-licenses.md'), 'utf8');
    expect(doc).toContain('SHARP_FORCE_GLOBAL_LIBVIPS');
    expect(doc).toContain('@img/sharp-libvips');
  });

  it('Dockerfile kopíruje text licence do image', async () => {
    const dockerfile = await readFile(join(root, 'docker', 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('LICENSES');
  });
});
