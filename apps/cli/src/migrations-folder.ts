import { fileURLToPath } from 'node:url';

/**
 * Adresář s migracemi.
 *
 * Je to jediné místo, kde se ta cesta odvozuje. Dřív ji znal jenom příkaz
 * `mlain migrate`, takže `mlain backup verify` spoléhal na výchozí odvození
 * uvnitř `@mlain/db/migrate` (`../migrations` vůči `import.meta.url`) a v
 * produkční image padal na
 *
 *   ENOENT: open '/app/apps/cli/migrations/meta/_journal.json'
 *
 * protože zabundlované CLI leží v `/app/apps/cli/dist/main.js`, kdežto migrace
 * v `/app/packages/db/migrations`. Dva příkazy, které dělají totéž, si cestu
 * nesmí odvozovat každý jinak.
 */
export function resolveMigrationsFolder(env: NodeJS.ProcessEnv): string {
  const override = env['MIGRATIONS_DIR'];
  if (override !== undefined && override !== '') return override;
  return fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));
}
