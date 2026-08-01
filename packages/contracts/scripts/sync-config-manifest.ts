import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Zrcadlí packages/core/src/config/config.manifest.json do packages/contracts/config.json.
 *
 * Je to KOPIE SOUBORU, ne import: graf závislostí říká `contracts -> nic` a
 * import by z kořene grafu udělal list. Čtení souboru žádnou build závislost
 * nezakládá a ESLint pravidlo import/no-restricted-paths se ho netýká.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.resolve(packageRoot, '..', 'core', 'src', 'config', 'config.manifest.json');
const TARGET = path.join(packageRoot, 'config.json');

export async function syncConfigManifest(check = false): Promise<boolean> {
  let source: string;
  try {
    source = await readFile(SOURCE, 'utf8');
  } catch {
    console.warn(`sync-config-manifest: ${SOURCE} zatím neexistuje, přeskakuji`);
    return true;
  }
  const parsed = JSON.parse(source) as { variables?: unknown[] };
  const mirrored =
    JSON.stringify(
      {
        generatedFrom: 'packages/core/src/config/config.manifest.json',
        variables: parsed.variables ?? [],
      },
      null,
      2,
    ) + '\n';

  if (check) {
    const current = await readFile(TARGET, 'utf8').catch(() => '');
    if (current !== mirrored) {
      console.error(
        'config.json není aktuální, spusť pnpm --filter @mlain/contracts run contracts:generate',
      );
      return false;
    }
    return true;
  }
  await writeFile(TARGET, mirrored, 'utf8');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = await syncConfigManifest(process.argv.includes('--check'));
  if (!ok) process.exit(1);
}
