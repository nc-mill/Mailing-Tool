import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * Kořen repozitáře se hledá vystoupáním od pracovního adresáře k
 * `pnpm-workspace.yaml`, ne z `import.meta.url`. Dva důvody, oba ověřené
 * spuštěním:
 *  - plán má cesty relativní ke kořeni, jenže `turbo run test:unit` pouští
 *    vitest v adresáři balíčku, takže by test padal na ENOENT podle toho,
 *    odkud se spustí,
 *  - `apps/web` má vitest v prostředí jsdom, kde `import.meta.url` NENÍ adresa
 *    se schématem `file:`, a `readFile` na ní skončí na
 *    „TypeError: The URL must be of scheme file".
 * Obojí je selhání, které se nejsnáz „opraví" smazáním testu, proto tenhle tvar.
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

const ROOT = repoRoot();
const WEB_DIR = join(ROOT, 'apps', 'web');

const CI_PATH = join(ROOT, '.github', 'workflows', 'ci.yml');
const WEB_PKG = join(WEB_DIR, 'package.json');
const TURBO_PATH = join(ROOT, 'turbo.json');

/**
 * Blok jobu `e2e` z workflow, tedy od jeho klíče po první další řádek odsazený
 * o dvě mezery.
 *
 * Plán tu má `/^\s{2}e2e:[\s\S]*?(?=^\s{2}\w|\Z)/m`. `\Z` je kotva konce vstupu
 * v Perlu a Ruby, v JavaScriptu ale znamená **písmeno Z**, takže ta alternativa
 * nikdy neudělá to, co má, a ESLint ji hlásí jako `no-useless-escape`. Řezání po
 * řádcích dělá totéž bez té pasti a čte se líp.
 */
function e2eBlock(ci: string): string {
  const lines = ci.split('\n');
  const start = lines.findIndex((line) => /^ {2}e2e:/.test(line));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('zapojení E2E do CI', () => {
  it('apps/web má skript test:e2e:golden, který pouští konfiguraci zlaté cesty', async () => {
    const pkg = JSON.parse(await readFile(WEB_PKG, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['test:e2e:golden']).toContain('playwright.golden.config.ts');
  });

  it('skript test:e2e pouští obě konfigurace, aby na zlatou cestu nikdo nezapomněl', async () => {
    const pkg = JSON.parse(await readFile(WEB_PKG, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['test:e2e']).toContain('test:e2e:golden');
  });

  it('job e2e v CI existuje a spouští test:e2e', async () => {
    const ci = await readFile(CI_PATH, 'utf8');
    expect(ci).toMatch(/^\s{2}e2e:/m);
    expect(ci).toContain('test:e2e');
  });

  it('job e2e má limit aspoň 20 minut podle tabulky v 3.15', async () => {
    const ci = await readFile(CI_PATH, 'utf8');
    const minutes = Number(e2eBlock(ci).match(/timeout-minutes:\s*(\d+)/)?.[1] ?? '0');
    expect(minutes).toBeGreaterThanOrEqual(20);
  });

  it('job e2e archivuje log kontejneru, aby se pád dal vyšetřit', async () => {
    const ci = await readFile(CI_PATH, 'utf8');
    const block = e2eBlock(ci);
    expect(block).toContain('upload-artifact');
    expect(block).toMatch(/playwright-report-golden/);
  });
});

/**
 * DOPLNĚK NAD PLÁN. Pět kontrol výše hlídá, že je zlatá cesta zapojená. Žádná
 * z nich ale nezachytí stav, na který tenhle projekt narazil u čtyř jiných bran:
 * job doběhne zeleně, protože NIC nespustil. Zelené CI přitom vypadá stejně,
 * takže si toho nikdo nevšimne, a jediná brána, která hlídá celý produkt,
 * přestane hlídat cokoliv.
 *
 * Tři cesty, kterými tichý přeskok vzniká, a kontrola na každou z nich:
 *   1. Úkol není v `turbo.json`. `pnpm turbo run test:e2e` pak vypíše
 *      „no tasks to run" a skončí nulou.
 *   2. Sada je prázdná nebo se rozešla s `testDir`. Playwright přeskočí,
 *      kdykoliv dostane `--pass-with-no-tests`.
 *   3. Krok si pád spolkne přes `continue-on-error` nebo `|| true`.
 */
describe('hlídač tichého přeskočení jobu e2e', () => {
  it('turbo zná úkol test:e2e, jinak je `turbo run test:e2e` zelený no-op', async () => {
    const turbo = JSON.parse(await readFile(TURBO_PATH, 'utf8')) as {
      tasks?: Record<string, unknown>;
    };
    expect(Object.keys(turbo.tasks ?? {})).toContain('test:e2e');
  });

  it('nikde není --pass-with-no-tests, které z prázdné sady udělá zelený běh', async () => {
    const pkg = await readFile(WEB_PKG, 'utf8');
    const ci = await readFile(CI_PATH, 'utf8');
    expect(pkg).not.toContain('pass-with-no-tests');
    expect(ci).not.toContain('pass-with-no-tests');
  });

  it('job e2e si pád kroku nespolkne', async () => {
    const block = e2eBlock(await readFile(CI_PATH, 'utf8'));
    expect(block).not.toMatch(/continue-on-error:\s*true/);

    // `|| true` se hledá jen na řádcích, které pouští testy. V diagnostickém
    // výpisu před `exit 1` je legitimní a plošný zákaz by hlásil falešný nález.
    const runsTests = block.split('\n').filter((line) => line.includes('test:e2e'));
    expect(runsTests.length).toBeGreaterThan(0);
    for (const line of runsTests) expect(line).not.toMatch(/\|\|\s*true/);
  });

  it('konfigurace P05 zlatou cestu nesbírá, jinak běží dvakrát a podruhé bez compose', async () => {
    // Nález proti P05. `playwright.config.ts` má `testDir: './e2e'`, takže si
    // vezme i `e2e/golden/specs/**`. Ty scénáře ale potřebují běžící compose
    // a poštovní past; pod konfigurací P05 se pustí proti holému dev serveru
    // a spadnou. Červená se pak přičte zlaté cestě, přestože vada je
    // v rozsahu konfigurace. Oprava patří do P05: `testIgnore: 'golden/**'`.
    const cli = join(WEB_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
    const listing = await run(process.execPath, [cli, 'test', '--list'], {
      cwd: WEB_DIR,
      maxBuffer: 32e6,
      env: { ...process.env, E2E_BASE_URL: 'http://127.0.0.1:1' },
    });
    expect(listing.stdout).not.toContain('golden/specs/');
  }, 120_000);

  it('konfigurace zlaté cesty skutečně nachází testy, ne prázdnou sadu', async () => {
    // Jediná kontrola, která nečte konfiguraci, ale ptá se Playwrightu. Statické
    // tvrzení o `testDir` přežije přejmenování adresáře, tohle ne.
    // `--list` nespouští globalSetup ani prohlížeč, takže compose k němu netřeba.
    const cli = join(WEB_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
    const listing = await run(
      process.execPath,
      [cli, 'test', '-c', 'playwright.golden.config.ts', '--list'],
      { cwd: WEB_DIR, maxBuffer: 32e6 },
    );
    const total = Number(listing.stdout.match(/Total:\s*(\d+)\s+tests?/)?.[1] ?? '0');
    expect(total).toBeGreaterThanOrEqual(5);
    for (const spec of [
      'golden-path.spec.ts',
      'trial-mode.spec.ts',
      'demo-data.spec.ts',
      'backup-restore.spec.ts',
      'first-run.spec.ts',
    ]) {
      expect(listing.stdout).toContain(spec);
    }
  }, 120_000);
});
