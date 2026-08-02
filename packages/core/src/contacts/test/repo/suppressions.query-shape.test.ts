import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { suppressedExistsSql } from '../../suppression/predicate';

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

// `e2e` je adresář se zlatými cestami v Playwrightu. Testy tam připravují výchozí
// stav přímým zápisem do databáze, takže je to testovací kód, ne produkční,
// jen se soubory jmenují `.spec.ts` místo `.test.ts`.
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'fixtures', 'e2e']);

function isTestFile(name: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(name);
}

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
    if (isTestFile(entry.name)) continue;
    const parts = full.split(sep);
    if (parts.includes('test') || parts.includes('tests')) continue;
    out.push(full);
  }
  return out;
}

/**
 * Věta o dotazu není dotaz. Bez tohohle kroku hlásil test jako porušení
 * `ops/db.ts`, kde je `SELECT DISTINCT fingerprint_key_id FROM suppressions`
 * uvnitř komentáře, který VYSVĚTLUJE, proč se ten dotaz musí spustit pod
 * migrátorskou rolí. Stejná třída falešného poplachu, jakou už jednou řešil
 * filtr `isCode` v `src/ai/wiring.test.ts`.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * POJMENOVANÉ VÝJIMKY z pravidla "kontrola se píše jen v repo/suppressions.ts".
 * Všechny jsou vypsané tady, ne schované v kódu, a každá je podmíněná testem.
 *
 * 1. `contacts/suppression/predicate.ts` je MNOŽINOVÁ podoba téže kontroly.
 *    Publikum kampaně má statisíce řádků a nedá se poskládat voláním
 *    `checkSuppression` na řádek, protože by to bylo statisíce kol do databáze;
 *    podmínka musí být součástí jednoho dotazu. Dřív si ji každý volající psal
 *    sám a byly z toho ČTYŘI kopie (materializace publika, obálka segmentu,
 *    rozpad publika po branách, operátor `is_suppressed`). Teď je jedna a test
 *    níž po ní vyžaduje všechny tři povinné podmínky.
 *
 * 2. Detail kontaktu (`contacts-query.ts`) si k řádku dotahuje důvod blokace, aby ho
 *    obrazovka mohla ukázat. Je to ČTENÍ PRO ZOBRAZENÍ, ne brána: o odeslání podle něj
 *    nikdo nerozhoduje. Větev přes otisk tam schválně není, protože po výmazu podle
 *    článku 17 už kontakt s tou adresou neexistuje a není co zobrazovat; podmínku
 *    `removed_at IS NULL` ale mít musí, jinak by detail ukazoval dávno sundanou blokaci.
 *
 * 3. `campaigns/repo/outbox.ts` (`reconcileSuppressed`) je ZÁCHYTNÁ CESTA nad frontou
 *    zpráv, ne nad kontakty: hledá `messages` ve stavu `pending`, kterým mezitím
 *    přibyla blokace, protože okamžitá cesta selhala (pád workeru, přímý zápis do
 *    databáze). Predikát nad kontaktem se na ni použít nedá, protože porovnává adresu
 *    ZPRÁVY, kterou kontakt už nemusí mít. Test níž po ní vyžaduje obě větve.
 *
 * 4. `ops/doctor/checks-keyring.ts` se neptá, jestli je adresa zablokovaná. Dělá
 *    inventuru pokolení šifrovacího klíče přes celou instalaci
 *    (`SELECT DISTINCT fingerprint_key_id`, `count(*)`) a běží pod migrátorskou rolí,
 *    tedy mimo RLS. Je to diagnostika, ne brána, a rozhodnutí o odeslání z ní
 *    nevychází.
 *
 * Nový soubor s vlastním dotazem povolený není a testy `jediné povolené místo` ho
 * zachytí. Zápis do tabulky výjimku nemá vůbec.
 */
const SET_QUERY_FILE = join(here, '..', '..', 'suppression', 'predicate.ts');
const DETAIL_QUERY_FILE = join(here, '..', '..', 'repo', 'contacts-query.ts');
const OUTBOX_RECONCILE_FILE = join(
  repoRoot,
  'packages',
  'core',
  'src',
  'campaigns',
  'repo',
  'outbox.ts',
);
const KEYRING_DOCTOR_FILE = join(
  repoRoot,
  'packages',
  'core',
  'src',
  'ops',
  'doctor',
  'checks-keyring.ts',
);

function productionFilesMatching(pattern: RegExp, allow: readonly string[] = []): string[] {
  const roots = [join(repoRoot, 'packages'), join(repoRoot, 'apps')];
  const exempt = new Set([sourceFile, ...allow]);
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of collectTsFiles(root)) {
      if (exempt.has(file)) continue;
      if (pattern.test(stripComments(readFileSync(file, 'utf8')))) {
        offenders.push(relative(repoRoot, file));
      }
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
  it('kontrola se nepíše nikde jinde než v repo/suppressions.ts a v pojmenovaných výjimkách', () => {
    expect(
      productionFilesMatching(/FROM\s+suppressions/i, [
        SET_QUERY_FILE,
        DETAIL_QUERY_FILE,
        OUTBOX_RECONCILE_FILE,
        KEYRING_DOCTOR_FILE,
      ]),
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

  it('množinová podoba kontroly nese všechny tři povinné podmínky', () => {
    // Měří se VÝSTUP funkce, ne text souboru: co se opravdu vloží do dotazu.
    const branch = suppressedExistsSql('c');

    // 1. Odebraná blokace se ignoruje.
    expect(branch).toMatch(/removed_at\s+IS\s+NULL/i);
    // 2. Větev přes otisk, tedy pokrytí adres vymazaných podle článku 17.
    expect(branch).toMatch(/fingerprint\s*=\s*ANY/i);
    // 3. Všechna pokolení klíče. Sloupec email_fingerprints nese otisk pod KAŽDÝM
    //    pokolením, takže porovnání proti němu strop nemá. Kdyby tam byl jednotlivý
    //    otisk pod aktuálním klíčem, první rotace by ochranu tiše odřízla.
    expect(branch).toContain('email_fingerprints');
    // Izolace projektu. Bez ní by predikát viděl blokace cizího projektu.
    expect(branch).toContain('su.workspace_id = c.workspace_id');
    // Alias se skládá do SQL textem, takže se ověřuje.
    expect(() => suppressedExistsSql('c; DROP TABLE contacts --')).toThrow();
  });

  it('množinovou podobu opravdu používají všichni čtyři volající', () => {
    // Kdyby některý volající přestal sdílenou funkci volat a napsal si predikát
    // znovu, test „jediné povolené místo" ho sice chytí, ale až podle textu SQL.
    // Tenhle test drží viditelné, KDO na ní stojí.
    const callers = [
      join(here, '..', '..', 'repo', 'contacts.ts'),
      join(repoRoot, 'packages', 'core', 'src', 'segments', 'audience.ts'),
      join(repoRoot, 'packages', 'core', 'src', 'segments', 'compile', 'envelope.ts'),
      join(repoRoot, 'packages', 'core', 'src', 'segments', 'compile', 'tag-list-consent.ts'),
    ];
    for (const caller of callers) {
      expect(readFileSync(caller, 'utf8'), caller).toContain('suppressedExistsSql');
    }
  });

  it('výjimka pro záchytnou cestu outboxu nese obě větve', () => {
    const outbox = stripComments(readFileSync(OUTBOX_RECONCILE_FILE, 'utf8'));
    const reconcile = outbox.slice(outbox.indexOf('export async function reconcileSuppressed'));
    expect(reconcile).toMatch(/removed_at\s+IS\s+NULL/i);
    // Větev přes otisk kontaktu, tedy pokrytí adres vymazaných podle článku 17.
    expect(reconcile).toMatch(/fingerprint\s*=\s*ANY/i);
    expect(reconcile).toContain('email_fingerprints');
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
