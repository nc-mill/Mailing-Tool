import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * Job, který zatím nemá co kontrolovat, hlásí SKIP a vrací 0 (rozhodnutí D8).
 * Nikdy se nepoužívá continue-on-error ani if: podmínka ve workflow, protože
 * to by znamenalo, že se brána zapne až někdy, a mezitím by se mergovalo bez ní.
 */
export function skip(reason) {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

export function fail(lines) {
  for (const line of Array.isArray(lines) ? lines : [lines]) {
    console.error(line);
  }
  process.exit(1);
}

export function ok(message) {
  console.log(`OK: ${message}`);
  process.exit(0);
}

/** Rekurzivně vypíše soubory s danou příponou. Vrací seřazené relativní cesty. */
export function listFiles(root, extension) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const walk = (dir, prefix) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = `${dir}/${entry.name}`;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.name.endsWith(extension)) found.push(relative);
    }
  };
  walk(root, '');
  return found;
}

/**
 * Spustí skript, který vlastní jiný balíček, a jeho výsledek prohlásí za
 * výsledek jobu.
 *
 * PROČ TAHLE VRSTVA EXISTUJE. Brány, které tenhle plán staví, kontrolují data
 * vyrobená jinými plány: fixtures vlastní P02, migrace P03. Kdyby si kontrolu
 * psal `tools/ci/*.mjs` sám, byla by to DRUHÁ implementace téhož pravidla,
 * která se s tou první tiše rozejde. Přesně to se stalo: skript porovnával
 * jména souborů fixtures, ale P02 mezitím zvolil jiné uspořádání adresářů,
 * jiná jména schémat i jiný soubor s kontraktními sloupci, takže brána buď
 * hlásila nesmysly, nebo mlčky přeskakovala.
 *
 * Dělba je proto tahle: **P01 vlastní JOB, vlastník dat vlastní KONTROLU.**
 * Job zjistí, jestli má co kontrolovat, a když ano, zavolá příkaz vlastníka.
 *
 * Polarita je záměrně nesymetrická (rozhodnutí D8):
 *   balíček neexistuje          -> SKIP, exit 0
 *   balíček existuje bez skriptu -> FAIL, protože brána by jinak zeleně
 *                                   nekontrolovala vůbec nic
 *   skript existuje              -> rozhoduje jeho exit code
 */
export function delegate({ packageName, directory, script, owner, purpose }) {
  const manifestPath = `${process.cwd()}/${directory}/package.json`;
  if (!fs.existsSync(`${process.cwd()}/${directory}`)) {
    skip(`${directory} zatím neexistuje, ${purpose} dodá plán ${owner}`);
  }
  if (!fs.existsSync(manifestPath)) {
    fail([
      `${directory} existuje, ale nemá package.json.`,
      `Plán ${owner} do něj musí zapsat skript "${script}".`,
    ]);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.scripts?.[script]) {
    fail([
      `${directory} existuje, ale skript "${script}" v jeho package.json chybí.`,
      `Dodává ho plán ${owner}: ${purpose}.`,
      'Chybějící kontrola se NIKDY nepřeskakuje: brána, která nic nekontroluje,',
      'je horší než brána, která neexistuje, protože vypadá funkčně.',
    ]);
  }
  try {
    // Pole argumentů, ne shell: interpolace do shellu je injekce.
    execFileSync('pnpm', ['--filter', packageName, 'run', script], { stdio: 'inherit' });
  } catch {
    fail([`${packageName} run ${script} selhal.`, `Kontrolu vlastní plán ${owner}.`]);
  }
}

/** Ploché klíče vnořeného JSON, například "auth.signIn.title". */
export function flattenKeys(value, prefix = '') {
  const keys = [];
  for (const [key, item] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      keys.push(...flattenKeys(item, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}
