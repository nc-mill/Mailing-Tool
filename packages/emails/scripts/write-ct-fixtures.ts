import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { CompiledFixture } from '@mlain/contracts/compiled';
import { CT_CASES, runCtCase } from '../test/golden/ct-cases';

const require = createRequire(import.meta.url);
const OUT = join(dirname(require.resolve('@mlain/contracts/package.json')), 'fixtures', 'compiled');

mkdirSync(OUT, { recursive: true });

let written = 0;
for (const testCase of CT_CASES) {
  const result = await runCtCase(testCase);

  if (result.ok && testCase.expect.error) {
    throw new Error(`${testCase.id}: čekala se chyba ${testCase.expect.error}, kompilace prošla`);
  }
  if (!result.ok && !testCase.expect.error) {
    throw new Error(`${testCase.id}: kompilace selhala: ${JSON.stringify(result.issues)}`);
  }
  if (!result.ok && !result.issues.some((issue) => issue.code === testCase.expect.error)) {
    throw new Error(
      `${testCase.id}: čekal se kód ${testCase.expect.error}, přišlo ${JSON.stringify(result.issues.map((i) => i.code))}`,
    );
  }

  const fixture: CompiledFixture = {
    id: testCase.id,
    description: testCase.description,
    document: testCase.document as unknown as Record<string, unknown>,
    context: testCase.context,
    // Klíč `compiled` je v `packages/contracts/schema/compiled.schema.json`
    // POVINNÝ a vlastníkem kontraktu je P02, takže ho má i chybový případ.
    // Plán P08 tady píše, že chybové fixtury `compiled` nemají; kdyby se to
    // vzalo doslova, spadl by jak runner `compiled.golden.test.ts`, tak
    // `scripts/validate-fixtures.ts`. Prázdné řetězce jsou pravdivá hodnota:
    // kompilace neprodukovala nic a případ pozná Go strana podle `expect.error`.
    compiled: result.ok ? { html: result.html, text: result.text } : { html: '', text: '' },
    expect: testCase.expect,
  };

  writeFileSync(join(OUT, `${testCase.id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  written += 1;
}

if (written !== 18) throw new Error(`zapsáno ${written} fixtur, čeká se 18`);
console.log(`zapsáno ${written} fixtur do ${OUT}`);
