import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type GoldenReport = {
  language: 'ts' | 'go';
  section: string;
  total: number;
  executed: number;
  skipped: number;
  /** seřazené id fixtur, které runner SKUTEČNĚ zpracoval */
  ids: string[];
  groups: Record<string, number>;
  /** SHA-256 nad seřazeným "jméno\0sha256(obsah)" všech souborů sekce */
  fixturesDigest: string;
};

/**
 * Otisk vstupních souborů sekce. Existuje proto, že adresář reports/ se nikde
 * nemaže: bez otisku by šlo lokálně dostat zelenou paritu nad reportem ze
 * starého běhu. check-parity otisk přepočítá z disku a vyžaduje shodu.
 */
export async function fixturesDigest(files: readonly string[]): Promise<string> {
  const outer = createHash('sha256');
  for (const file of [...files].sort()) {
    const body = await readFile(file);
    outer.update(path.basename(file));
    outer.update('\0');
    outer.update(createHash('sha256').update(body).digest('hex'));
    outer.update('\n');
  }
  return outer.digest('hex');
}

/**
 * `skipped` se POČÍTÁ, nepíše. Volající předá seznam id, která opravdu proběhla,
 * a celkový počet použitelných; rozdíl je počet přeskočených. Literál nula na
 * tomhle místě byl důvod, proč dřívější kontrola „nepřeskočené fixtures" neměřila nic.
 */
export async function writeGoldenReport(input: {
  section: string;
  total: number;
  ids: readonly string[];
  groups?: Record<string, number>;
  files: readonly string[];
}): Promise<void> {
  const ids = [...input.ids].sort();
  const report: GoldenReport = {
    language: 'ts',
    section: input.section,
    total: input.total,
    executed: ids.length,
    skipped: input.total - ids.length,
    ids,
    groups: input.groups ?? {},
    fixturesDigest: await fixturesDigest(input.files),
  };
  await mkdir(path.join(packageRoot, 'reports'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'reports', `ts-golden-${input.section}.json`),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );
}
