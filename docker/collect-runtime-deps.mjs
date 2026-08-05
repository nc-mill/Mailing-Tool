/**
 * Posbírá do `/runtime-deps/node_modules` balíčky, které se NESMÍ zabundlovat.
 *
 * Nativní knihovny esbuild zabalit neumí, takže jsou v `apps/worker/build.mjs`
 * mezi `external` a runtime vrstva image je musí dostat jinak. Dokud tu byl jen
 * `@node-rs/argon2`, stačil jeden `cp` přímo v Dockerfile. S příchodem `sharp`
 * to přestalo platit ze tří důvodů a každý z nich se projevil až za běhu:
 *
 *   1. `sharp` má vlastní javascriptové závislosti (`detect-libc`, `color`,
 *      `semver` a jejich vlastní). Bez nich: `Cannot find module 'detect-libc'`.
 *   2. Platformové varianty (`@img/sharp-linuxmusl-arm64`) pnpm NELINKUJE
 *      do `node_modules` balíčku `sharp`, zvedá je na společnou úroveň
 *      `.pnpm/node_modules/@img`. Dohledávání přes `require.resolve` od `sharp`
 *      je proto mine a chybí nativní knihovna:
 *      `Could not load the "sharp" module using the linuxmusl-arm64 runtime`.
 *   3. Ruční výčet balíčků by po každém povýšení verze mlčky zastaral.
 *
 * Proč samostatný soubor a ne příkaz v Dockerfile: víceřádkový skript uvnitř
 * `RUN node -e "…"` prochází shellem, který v dvojitých uvozovkách provede
 * všechno ve zpětných apostrofech. Komentář se zpětnými apostrofy kolem jmen
 * balíčků se tím tiše vykonal jako příkaz a skript se rozpadl. Sem si shell
 * nesáhne.
 *
 * Dosah, kdyby to chybělo: padá WORKER, a protože `MODE=all` drží tři procesy
 * pohromadě, sundá to celý kontejner do restartové smyčky. Web přitom stihne
 * naběhnout a `/api/health/ready` chvíli odpovídá, takže se to při povrchní
 * kontrole tváří zdravě. Pozná se to teprve tím, že nejde založit první účet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const FROM = '/app/packages/core';
const DEST = '/runtime-deps/node_modules';
const HOISTED_IMG = '/app/node_modules/.pnpm/node_modules/@img';

/** Balíčky, které se sbírají i s celým uzávěrem svých závislostí. */
const ROOTS = ['@node-rs/argon2', 'sharp'];

const collected = new Set();

function collect(name, from) {
  if (collected.has(name)) return;
  let manifest;
  try {
    manifest = require.resolve(`${name}/package.json`, { paths: from });
  } catch {
    // Platformové varianty pro cizí architektury nainstalované nejsou.
    // Jejich nepřítomnost není chyba, chybí až ta pro TUHLE platformu,
    // což odhalí ověření na konci.
    return;
  }
  collected.add(name);
  const dir = path.dirname(manifest);
  fs.cpSync(dir, path.join(DEST, name), { recursive: true, dereference: true });
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    collect(dep, [dir]);
  }
}

for (const root of ROOTS) collect(root, [FROM]);

// Kopíruje se PO POLOŽKÁCH, ne celý adresář naráz: `@img` už může existovat
// z předchozího kroku (nějakou platformovou variantu dohledá `require.resolve`
// sám) a `cpSync` na existující adresář skončí na `EEXIST`.
if (fs.existsSync(HOISTED_IMG)) {
  for (const entry of fs.readdirSync(HOISTED_IMG)) {
    fs.cpSync(path.join(HOISTED_IMG, entry), path.join(DEST, '@img', entry), {
      recursive: true,
      dereference: true,
      force: true,
    });
    collected.add(`@img/${entry}`);
  }
}

console.log(`runtime-deps: ${collected.size} balíčků`);
for (const name of [...collected].sort()) console.log(`  ${name}`);
