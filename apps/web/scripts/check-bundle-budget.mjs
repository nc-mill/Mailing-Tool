#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
// Sdílená ESLint konfigurace (packages/config, vlastní P01, P05 ji jen čte)
// deklaruje globály `process`/`console` pro .mjs skripty, ale ne `URL`.
// Explicitní import místo globálu je jediná úprava, kterou smí tenhle
// soubor udělat, aniž by sahal do cizí konfigurace.
import { URL } from 'node:url';

const LIMIT_BYTES = 250 * 1024;

/** Moduly, které se do základního balíku nesmí dostat (kritérium 82). */
const LAZY_ONLY = ['recharts', 'query-builder', 'template-editor'];

export function evaluateBudget({ firstLoadBytes, limitBytes, lazyOnlyModules }) {
  const problems = [];

  if (firstLoadBytes > limitBytes) {
    const overKb = Math.round((firstLoadBytes - limitBytes) / 1024);
    problems.push(
      `Základní balík má ${Math.round(firstLoadBytes / 1024)} kB, limit je ${Math.round(
        limitBytes / 1024,
      )} kB. Je o ${overKb} kB větší.`,
    );
  }

  for (const module of lazyOnlyModules) {
    problems.push(`Modul ${module} nesmí být v základním balíku, načítá se líně.`);
  }

  return { ok: problems.length === 0, message: problems.join('\n') };
}

/**
 * Odchylka od plánu: plán počítá s `.next/app-build-manifest.json` a
 * `.next/build-stats.json`. Ani jeden soubor Next.js 16 s Turbopackem
 * nevytváří (ověřeno spuštěným `next build`, viz `.next/` po sestavení).
 * `firstLoadGzipBytes` odpovídá tomu, co Next.js sám nazývá „First Load JS
 * shared by all": kořenové soubory, které se stáhnou na každé stránce,
 * bez ohledu na to, co si stránka doimportuje navíc. Ty skutečně existují
 * v `.next/build-manifest.json` jako `rootMainFiles` a `polyfillFiles`.
 *
 * Cílová stránka skořápky `/[locale]/w/[workspaceSlug]/page` navíc v době
 * psaní tohohle skriptu ještě nemá `page.tsx` (jen `layout.tsx`), takže by
 * v žádném manifestu nebyla ani teoreticky. Kontrola proto míří na sdílený
 * základ, který platí pro každou stránku už teď. Až doménový plán stránku
 * skořápky založí, může sem přidat i její vlastní chunky přes stejnou
 * funkci `firstLoadBundle()`.
 */
async function firstLoadBundle() {
  const root = new URL('../.next/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('build-manifest.json', root), 'utf8'));
  const files = [...new Set([...manifest.rootMainFiles, ...manifest.polyfillFiles])];

  let firstLoadBytes = 0;
  let combinedSource = '';
  for (const file of files) {
    const source = await readFile(new URL(file, root));
    firstLoadBytes += gzipSync(source).length;
    combinedSource += source.toString('utf8');
  }

  const lazyOnlyModules = LAZY_ONLY.filter((module) => combinedSource.includes(module));
  return { firstLoadBytes, lazyOnlyModules };
}

async function main() {
  const { firstLoadBytes, lazyOnlyModules } = await firstLoadBundle();
  const result = evaluateBudget({ firstLoadBytes, limitBytes: LIMIT_BYTES, lazyOnlyModules });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  // Sdílené `no-console` pravidlo povoluje jen `console.error` a tenhle
  // soubor nesmí měnit cizí ESLint konfiguraci. Úspěšné hlášení proto jde
  // přímo na stdout, ne přes `console.log`.
  process.stdout.write(
    `Základní balík: ${Math.round(firstLoadBytes / 1024)} kB gzip, limit je 250 kB.\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
