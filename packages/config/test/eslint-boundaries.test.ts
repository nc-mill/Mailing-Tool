import { ESLint, type Linter } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundariesConfig } from '../eslint/boundaries.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

async function lint(relativeFile: string, code: string) {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    // boundaries.js je JavaScript s checkJs: false, takže se pole `rules`
    // odvodí jako obecné pole, ne jako n-tice [Severity, ...]. Přetypování je
    // tady jediné místo, kde se ten rozdíl srovná; běh testu je na něm nezávislý.
    overrideConfig: boundariesConfig() as unknown as Linter.Config[],
  });
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relativeFile) });
  return result?.messages ?? [];
}

describe('hranice mezi balíčky', () => {
  it('zakáže import @mlain/core z packages/db', async () => {
    const messages = await lint(
      'packages/db/src/repo.ts',
      `import { x } from '@mlain/core/errors';\n`,
    );
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  it('povolí import @mlain/contracts z packages/db', async () => {
    const messages = await lint(
      'packages/db/src/repo.ts',
      `import { x } from '@mlain/contracts';\n`,
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  it('zakáže packages/contracts importovat cokoliv z monorepa', async () => {
    const messages = await lint(
      'packages/contracts/src/liquid.ts',
      `import { x } from '@mlain/i18n';\n`,
    );
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  it('zakáže apps/worker importovat @mlain/ui', async () => {
    const messages = await lint('apps/worker/src/main.ts', `import { x } from '@mlain/ui';\n`);
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  // Relativní přechod přes hranici hlídá `import/no-restricted-paths` v index.js,
  // ne `no-restricted-imports`, protože jen ten specifikátor rozřeší na cestu.
  // Jeho test je v samostatném souboru eslint-zones.test.ts, protože index.js
  // vzniká až o dva kroky dál.

  it('zakáže top level barrel @mlain/core odkudkoliv', async () => {
    const messages = await lint('apps/web/src/app/page.tsx', `import { x } from '@mlain/core';\n`);
    const barrel = messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(barrel.length).toBeGreaterThan(0);
    expect(barrel[0]?.message).toContain('podcestu');
  });

  // Tenhle test je hlavní pojistka proti záměně `paths` a `patterns`.
  // `patterns` má gitignore sémantiku, takže vzor '@mlain/core' zakáže i každou
  // jeho podcestu; od úkolu 11 dál by tím byl zakázaný ÚPLNĚ KAŽDÝ import z core
  // a lint by byl červený navždy. `paths` porovnává specifikátor přesně.
  it('zákaz barrelu nesmí zasáhnout podcesty @mlain/core', async () => {
    for (const specifier of ['@mlain/core/errors', '@mlain/core/config', '@mlain/core/queues']) {
      const messages = await lint(
        'apps/web/src/app/page.tsx',
        `import { x } from '${specifier}';\n`,
      );
      expect(
        messages.filter((m) => m.ruleId === 'no-restricted-imports'),
        `${specifier} musí být povolený, zákaz se týká jen holého @mlain/core`,
      ).toEqual([]);
    }
  });

  it('povolí import @mlain/emails z packages/core (hrana pro P08)', async () => {
    const messages = await lint(
      'packages/core/src/templates/validate.ts',
      `import { x } from '@mlain/emails/document/schema';\n`,
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });
});
