import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGET = path.join(ROOT, 'apps/worker/src/handlers.generated.ts');

/**
 * ROZHODNUTÍ D4. Uzávěr S8 chce, aby si handlery psala každá doména do svého
 * souboru a entrypoint je jen složil. Ruční výčet by ale byl sdílený soubor
 * editovaný osmi plány, tedy osm merge konfliktů. Tenhle skript proto najde
 * všechny existující moduly `packages/core/src/<domena>/jobs/queue-handlers.ts`
 * a vyrobí z nich statickou mapu.
 *
 * Platí u něj stejné pravidlo jako u openapi.json (uzávěr S9): soubor se nikdy
 * neslučuje ručně, při konfliktu se přegeneruje.
 */
function findHandlerModules() {
  const coreSrc = path.join(ROOT, 'packages/core/src');
  if (!fs.existsSync(coreSrc)) return [];

  /**
   * Hledá se i VE DRUHÉ ÚROVNI, ne jen v přímých podadresářích.
   *
   * Původně se procházely jen `packages/core/src/<domena>/jobs/`, takže
   * `contacts/export/jobs` a `contacts/import/jobs` codegen nikdy neviděl,
   * přestože soubor i klíč v `exports` mapě měly. Fronty importu a exportu
   * kontaktů se tedy zaregistrovaly BEZ OBSLUHY: úloha se zařadila, nikdo si ji
   * nevyzvedl a import prostě nikdy neskončil.
   *
   * Nic přitom nespadlo. Worker při startu vypíše seznam front bez handleru,
   * ale nikdo ten řádek nečte, a uživatel vidí import, který se tváří, že běží.
   *
   * Hloubka je omezená na dvě úrovně schválně: dál by se hledaly `jobs`
   * adresáře i tam, kde nemají co dělat, a jméno domény by přestalo odpovídat
   * prefixu jména fronty, podle kterého se odvozuje.
   */
  const nalezene = [];
  for (const uroven1 of fs.readdirSync(coreSrc, { withFileTypes: true })) {
    if (!uroven1.isDirectory()) continue;
    if (fs.existsSync(path.join(coreSrc, uroven1.name, 'jobs/queue-handlers.ts'))) {
      nalezene.push(uroven1.name);
      continue;
    }
    const vnoreno = path.join(coreSrc, uroven1.name);
    for (const uroven2 of fs.readdirSync(vnoreno, { withFileTypes: true })) {
      if (!uroven2.isDirectory()) continue;
      if (fs.existsSync(path.join(vnoreno, uroven2.name, 'jobs/queue-handlers.ts'))) {
        nalezene.push(`${uroven1.name}/${uroven2.name}`);
      }
    }
  }
  return nalezene.sort();
}

/**
 * Ověří, že každá nalezená doména má v `packages/core/package.json` explicitní
 * klíč `"./<domena>/jobs"`. Bez něj se import nerozřeší a build workeru spadne.
 *
 * PROČ TENHLE HLÍDAČ EXISTUJE: mapa `exports` měla obecný vzor s hvězdičkou uprostřed,
 * jenže Node ani esbuild neberou v potaz pořadí klíčů, rozhoduje délka základu
 * vzoru. Jakmile doména dostala vlastní vzor se svým jménem, přebil obecný vzor
 * a import se rozvinul na soubor, který neexistuje. Stalo se to dvakrát,
 * u `platform` a pak u `ai`, a pokaždé se to projevilo až při stavbě produkční
 * image, tedy hodně daleko od příčiny.
 *
 * Obecný vzor je proto zrušený a klíče jsou vypsané. Tenhle hlídač zajišťuje,
 * že chybějící zápis padne HLASITĚ tady, ne tiše až v Dockerfile.
 */
function assertExportsMapCovers(domains) {
  const manifestPath = path.join(ROOT, 'packages/core/package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const exportsMap = manifest.exports ?? {};
  const chybi = domains.filter((domain) => !(`./${domain}/jobs` in exportsMap));
  if (chybi.length > 0) {
    const radky = chybi
      .map((d) => `    "./${d}/jobs": "./src/${d}/jobs/queue-handlers.ts",`)
      .join('\n');
    throw new Error(
      `packages/core/package.json nemá v "exports" klíč pro tyhle domény s frontami: ` +
        `${chybi.join(', ')}.\nDoplň do mapy "exports":\n${radky}`,
    );
  }
}

function render(domains) {
  const imports = domains
    .map((domain, index) => `import { handlers as h${index} } from '@mlain/core/${domain}/jobs';`)
    .join('\n');
  const spread = domains.map((_, index) => `  ...h${index},`).join('\n');

  return `// GENEROVANÝ SOUBOR. Nezapisuj do něj ručně, soubor se nikdy neslučuje ručně.
// Vyrábí ho apps/worker/codegen.mjs z modulů packages/core/src/<domena>/jobs/queue-handlers.ts.
// Při konfliktu v gitu zahoď obě verze a spusť: pnpm --filter @mlain/worker run codegen
import type { QueueHandler } from '@mlain/core/queues';
${imports}

export const HANDLERS: Record<string, QueueHandler> = {
${spread}
};
`;
}

const domains = findHandlerModules();
assertExportsMapCovers(domains);
const output = render(domains);
if (process.argv.includes('--stdout')) {
  process.stdout.write(output);
} else {
  fs.writeFileSync(TARGET, output);
  console.log(`Zapsáno ${TARGET}`);
}
