import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * JEDINÉ místo, které skládá cestu k adresáři s migracemi.
 *
 * Historie, kvůli které tenhle soubor existuje: `runMigrations` si dřív cestu
 * odvozoval sám jako `../migrations` vůči `import.meta.url`. To platí, dokud
 * modul běží ze svého místa ve stromu. CLI i worker se ale bundlují esbuildem
 * do jediného souboru, takže `import.meta.url` ukazuje na
 * `/app/apps/cli/dist/main.js`, kdežto migrace leží v
 * `/app/packages/db/migrations`. Odvození vyšlo na `/app/apps/cli/migrations`
 * a příkaz spadl na
 *
 *   ENOENT: no such file or directory,
 *   open '/app/apps/cli/migrations/meta/_journal.json'
 *
 * Obcházelo se to tak, že si volající cestu předával sám. Jenže „volající si
 * to musí pamatovat" je pravidlo, ne pojistka: pamatoval si to `mlain migrate`,
 * potom `mlain backup verify`, a na `restore`, `upgrade` a nedělní ověření
 * zálohy ve workeru se zapomnělo. Proto jsou tady OBĚ pojistky:
 *
 *  1. `migrationsFolder` je v `RunMigrationsOptions` POVINNÝ. Čtvrté zapomenuté
 *     místo se nepřeloží, tedy nemůže vzniknout.
 *  2. Odvození je tady, jedno pro všechny. Nikdo si ho neskládá po svém.
 *
 * Hledá se VYSTOUPÁNÍM, ne pevným počtem `..`. Pevný počet by fungoval jen
 * tam, kde je modul zrovna ve stejné hloubce jako bundl; přesně tahle tichá
 * závislost na hloubce byla podstatou původní vady. Vystoupání vyjde stejně
 * ze zdrojů (`packages/db/src` → kořen repozitáře) i z obou bundlů
 * (`/app/apps/{cli,worker}/dist` → `/app`).
 */
export class MigrationsFolderNotFoundError extends Error {
  constructor(readonly searched: readonly string[]) {
    super(
      'Adresář s migracemi se nenašel. Prohledané cesty:\n' +
        searched.map((path) => `  ${path}`).join('\n') +
        '\nNastavte MIGRATIONS_DIR na adresář, který obsahuje meta/_journal.json.',
    );
    this.name = 'MigrationsFolderNotFoundError';
  }
}

/** Adresář je platný jedině s žurnálem; jinak by runner spadl až na ENOENT uvnitř. */
export function isMigrationsFolder(candidate: string): boolean {
  return existsSync(join(candidate, 'meta', '_journal.json'));
}

/**
 * Stoupá od `startDir` ke kořeni a v každé úrovni zkouší `packages/db/migrations`.
 * Vydělené kvůli testu, který umí ověřit produkční rozložení
 * (`/app/apps/cli/dist` vedle `/app/packages/db/migrations`) bez stavby image.
 */
export function findMigrationsFolderFrom(startDir: string): string {
  const searched: string[] = [];
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'packages', 'db', 'migrations');
    searched.push(candidate);
    if (isMigrationsFolder(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new MigrationsFolderNotFoundError(searched);
}

/**
 * `MIGRATIONS_DIR` je únikový východ pro nestandardní rozložení. Běžně se
 * nenastavuje a hodnota se NEOVĚŘUJE proti disku: kdo ji nastaví, ví, co dělá,
 * a runner na neplatné cestě stejně skončí srozumitelnou chybou.
 */
export function resolveMigrationsFolder(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['MIGRATIONS_DIR'];
  if (override !== undefined && override !== '') return override;
  return findMigrationsFolderFrom(dirname(fileURLToPath(import.meta.url)));
}
