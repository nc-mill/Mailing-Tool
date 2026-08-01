import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Ajv (import výchozí z 'ajv') rozumí jen draft-07. Naše schémata deklarují
// $schema 2020-12, takže je potřeba varianta Ajv2020 z 'ajv/dist/2020.js'.
// Ověřeno spuštěním: s plain Ajv skončí compile chybou
// "no schema with key or ref https://json-schema.org/draft/2020-12/schema".
//
// Obě knihovny jsou CJS balíčky bez "type": "module" ve svém package.json.
// Pod moduleResolution NodeNext bere tsc jejich .d.ts jako CommonJS soubor,
// takže výchozí import (`import X from '...'`) typuje jako CELÝ modul
// (`typeof import(...)`), ne jako reálný `export default` z .d.ts, a je
// pak "not constructable" / "not callable". Ověřeno spuštěním: pojmenovaný
// import třídy funguje (Ajv2020 je v .d.ts i named export), ale ajv-formats
// named export pro hodnotu nemá, jen pro typ (`FormatsPlugin`), takže se
// runtime hodnota bere přes createRequire a typ zvlášť přes named type import.
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';

const require = createRequire(import.meta.url);
const addFormats: FormatsPlugin = require('ajv-formats');

type ExtraFixture = { file: string; schema: string; data: unknown };

/**
 * Mapa adresář -> schéma. Jména schémat jsou totožná se jmény adresářů, protože
 * přesně tak je skládá tools/ci/contracts-fixtures-schema.mjs z P01 a job by
 * jinak hlásil chybu u každé skupiny (rozhodnutí D12). Mapa se proto nepíše
 * ručně, ale odvozuje z adresářů, a `only` jen zužuje, které soubory ve skupině
 * se validují.
 */
const GROUPS: Array<{ dir: string; only?: string[] }> = [
  { dir: 'liquid' },
  { dir: 'markers' },
  { dir: 'compiled' },
  { dir: 'token', only: ['vectors.json'] },
  { dir: 'crypto', only: ['vectors.json'] },
  { dir: 'message-id', only: ['vectors.json'] },
  { dir: 'outbox', only: ['scenarios.json'] },
];

export async function validateAllFixtures(
  packageRoot: string,
  options: { extra?: ExtraFixture[] } = {},
): Promise<{ validated: number; errors: string[] }> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const compiled = new Map<string, ReturnType<typeof ajv.compile>>();
  for (const name of [...GROUPS.map((group) => group.dir), 'config', 'columns']) {
    const schema = JSON.parse(
      await readFile(path.join(packageRoot, 'schema', `${name}.schema.json`), 'utf8'),
    );
    compiled.set(name, ajv.compile(schema));
  }

  const errors: string[] = [];
  let validated = 0;

  for (const group of GROUPS) {
    const dir = path.join(packageRoot, 'fixtures', group.dir);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch {
      // Adresář, který ve struktuře je a na disku chybí, je chyba, ne důvod
      // k tichému přeskočení. Prázdný adresář (compiled do doby, než ho naplní
      // P08) je v pořádku, protože readdir vrátí prázdné pole.
      errors.push(`fixtures/${group.dir} neexistuje`);
      continue;
    }
    for (const file of files) {
      if (group.only && !group.only.includes(file)) {
        errors.push(`fixtures/${group.dir}/${file} není ve výčtu souborů skupiny`);
        continue;
      }
      const data = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
      const validate = compiled.get(group.dir)!;
      validated += 1;
      if (!validate(data)) {
        errors.push(
          `${group.dir}/${file}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`,
        );
      }
    }
  }

  // Manifest kontraktních sloupců neleží ve fixtures, ale v schema/, protože
  // přesně odtud ho čte tools/ci/contracts-schema.mjs z P01 (rozhodnutí D13).
  const columnsFile = path.join(packageRoot, 'schema', 'columns.json');
  const columnsValidate = compiled.get('columns')!;
  validated += 1;
  const columns = JSON.parse(await readFile(columnsFile, 'utf8'));
  if (!columnsValidate(columns)) {
    errors.push(
      `schema/columns.json: ${ajv.errorsText(columnsValidate.errors, { separator: '; ' })}`,
    );
  }

  for (const extra of options.extra ?? []) {
    const validate = compiled.get(extra.schema)!;
    validated += 1;
    if (!validate(extra.data)) {
      errors.push(`${extra.file}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
    }
  }

  return { validated, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await validateAllFixtures(packageRoot);
  if (result.errors.length > 0) {
    console.error(`contracts-fixtures-schema: ${result.errors.length} chyb`);
    for (const error of result.errors) console.error('  ' + error);
    process.exit(1);
  }
  console.log(`contracts-fixtures-schema: ${result.validated} souborů v pořádku`);
}
