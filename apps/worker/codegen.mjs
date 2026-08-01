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
  return fs
    .readdirSync(coreSrc, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((domain) => fs.existsSync(path.join(coreSrc, domain, 'jobs/queue-handlers.ts')))
    .sort();
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

const output = render(findHandlerModules());
if (process.argv.includes('--stdout')) {
  process.stdout.write(output);
} else {
  fs.writeFileSync(TARGET, output);
  console.log(`Zapsáno ${TARGET}`);
}
