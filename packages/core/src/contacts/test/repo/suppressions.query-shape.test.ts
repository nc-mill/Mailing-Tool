import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Strukturální pojistka nad dvěma pravidly, na kterých tahle doména stojí:
 * `suppressions.check` je JEDINÉ povolené místo kontroly a `suppressions.add` JEDINÁ
 * cesta k zablokování.
 *
 * Test na tvar dotazu je tady schválně vedle testu na chování. Chování by prošlo i se
 * dvěma podmínkami ze tří, pokud by testovací data nepokryla přesně ten případ;
 * kontrola textu zachytí i vynechání, které se navenek neprojeví hned.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ PROSTŘEDÍM. Plán četl soubory relativní cestou od kořene
 * repozitáře a hledal je přes `globSync` z `node:fs`. Vitest běží s pracovním adresářem
 * balíčku, takže by `readFileSync('packages/core/...')` skončilo na ENOENT, a `globSync`
 * s volbou `exclude` je novinka, na kterou se v testu spoléhat nemusíme. Cesty se proto
 * odvozují od tohohle souboru a strom se prochází ručně.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');
const sourceFile = join(here, '..', '..', 'repo', 'suppressions.ts');
const source = readFileSync(sourceFile, 'utf8');

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'fixtures']);

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      collectTsFiles(full, out);
      continue;
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    // Testy a jejich pomůcky smějí do tabulky sáhnout přímo: připravují výchozí stav
    // a kontrolují výsledek, tedy dělají přesně to, co produkční kód dělat nesmí.
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
    const parts = full.split(sep);
    if (parts.includes('test') || parts.includes('tests')) continue;
    out.push(full);
  }
  return out;
}

/**
 * DVĚ pojmenované výjimky z pravidla "kontrola se píše jen v repo/suppressions.ts".
 * Obě jsou vypsané tady, ne schované v kódu, a obě jsou podmíněné testy níž.
 *
 * 1. `listMailableContacts` staví publikum kampaně, tedy množinu o statisících řádcích.
 *    Ta se z principu nedá poskládat voláním `checkSuppression` na řádek, protože by to
 *    bylo statisíce kol do databáze; podmínka musí být součástí jednoho množinového
 *    dotazu. Test proto po ní vyžaduje všechny tři povinné podmínky. Kdyby kterákoliv
 *    zmizela, spadne tenhle soubor, ne až doručený e-mail vymazanému člověku.
 *
 * 2. Detail kontaktu (`contacts-query.ts`) si k řádku dotahuje důvod blokace, aby ho
 *    obrazovka mohla ukázat. Je to ČTENÍ PRO ZOBRAZENÍ, ne brána: o odeslání podle něj
 *    nikdo nerozhoduje. Větev přes otisk tam schválně není, protože po výmazu podle
 *    článku 17 už kontakt s tou adresou neexistuje a není co zobrazovat; podmínku
 *    `removed_at IS NULL` ale mít musí, jinak by detail ukazoval dávno sundanou blokaci.
 *
 * Nový soubor s vlastním dotazem povolený není a testy `jediné povolené místo` ho
 * zachytí. Zápis do tabulky výjimku nemá vůbec.
 */
const AUDIENCE_QUERY_FILE = join(here, '..', '..', 'repo', 'contacts.ts');
const DETAIL_QUERY_FILE = join(here, '..', '..', 'repo', 'contacts-query.ts');

function productionFilesMatching(pattern: RegExp, allow: readonly string[] = []): string[] {
  const roots = [join(repoRoot, 'packages'), join(repoRoot, 'apps')];
  const exempt = new Set([sourceFile, ...allow]);
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of collectTsFiles(root)) {
      if (exempt.has(file)) continue;
      if (pattern.test(readFileSync(file, 'utf8'))) offenders.push(relative(repoRoot, file));
    }
  }
  return offenders;
}

describe('tvar kontrolního dotazu', () => {
  it('obsahuje removed_at IS NULL', () => {
    expect(source).toContain('removed_at IS NULL');
  });

  it('obsahuje větev přes fingerprint', () => {
    expect(source).toContain('fingerprint = ANY');
  });

  it('používá otisky pro všechna pokolení, ne jen aktuální', () => {
    expect(source).toContain('computeAllFingerprintsBatch');
    // computeCurrentFingerprint v souboru zůstává, protože jím `addSuppression` počítá
    // otisk NOVÉHO řádku. Kontrola ho ale použít nesmí, proto se hlídá blok dotazu.
    const checkBody = source.slice(
      source.indexOf('export async function checkSuppression'),
      source.indexOf('export async function checkSingleSuppression'),
    );
    expect(checkBody).toContain('computeAllFingerprintsBatch');
    expect(checkBody).not.toContain('computeCurrentFingerprint');
  });
});

describe('jediné povolené místo', () => {
  it('kontrola se nepíše nikde jinde než v repo/suppressions.ts a ve dvou pojmenovaných výjimkách', () => {
    expect(
      productionFilesMatching(/FROM\s+suppressions/i, [AUDIENCE_QUERY_FILE, DETAIL_QUERY_FILE]),
    ).toEqual([]);
  });

  it('výjimka pro detail kontaktu je jen čtení a ignoruje sundané blokace', () => {
    const detail = readFileSync(DETAIL_QUERY_FILE, 'utf8');
    const query = detail.slice(detail.indexOf('FROM suppressions'));
    expect(query.slice(0, query.indexOf(') AS'))).toMatch(/removed_at\s+IS\s+NULL/i);
    // Zobrazovací dotaz nesmí být branou: kdyby podle něj někdo rozhodoval o odeslání,
    // obešel by tím větev přes otisky a vymazaný člověk by mail dostal.
    expect(detail).not.toMatch(/INSERT\s+INTO\s+suppressions/i);
    expect(detail).not.toMatch(/UPDATE\s+suppressions/i);
  });

  it('výjimka pro materializaci publika nese všechny tři povinné podmínky', () => {
    const audience = readFileSync(AUDIENCE_QUERY_FILE, 'utf8');
    const query = audience.slice(audience.indexOf('FROM suppressions'));
    const branch = query.slice(0, query.indexOf(')'));

    // 1. Odebraná blokace se ignoruje.
    expect(branch).toMatch(/removed_at\s+IS\s+NULL/i);
    // 2. Větev přes otisk, tedy pokrytí adres vymazaných podle článku 17.
    expect(branch).toMatch(/fingerprint\s*=\s*ANY/i);
    // 3. Všechna pokolení klíče. Sloupec email_fingerprints nese otisk pod KAŽDÝM
    //    pokolením, takže porovnání proti němu strop nemá. Kdyby tam byl jednotlivý
    //    otisk pod aktuálním klíčem, první rotace by ochranu tiše odřízla.
    expect(branch).toContain('email_fingerprints');
  });

  it('zablokovat adresu jde jen přes addSuppression', () => {
    expect(productionFilesMatching(/INSERT\s+INTO\s+suppressions/i)).toEqual([]);
  });

  it('odblokovat adresu jde jen přes removeSuppression', () => {
    expect(productionFilesMatching(/UPDATE\s+suppressions/i)).toEqual([]);
  });

  it('pojistka sama funguje: hlídaný vzor v hlídaném souboru skutečně je', () => {
    // Kdyby se dotaz přejmenoval nebo přesunul, testy výš by prošly nad prázdnou
    // množinou a nic by nehlídaly. Tenhle případ to odhalí.
    expect(source).toMatch(/FROM\s+suppressions/i);
    expect(source).toMatch(/INSERT\s+INTO\s+suppressions/i);
    expect(source).toMatch(/UPDATE\s+suppressions/i);
  });
});
