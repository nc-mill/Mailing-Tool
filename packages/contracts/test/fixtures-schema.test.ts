import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAllFixtures } from '../scripts/validate-fixtures';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('schémata fixtures', () => {
  it('každý adresář fixtures má schéma pojmenované tak, jak ho hledá P01', async () => {
    // tools/ci/contracts-fixtures-schema.mjs skládá jméno jako
    // `<první segment cesty fixture>.schema.json`. Kontrola se proto POČÍTÁ
    // z adresářů, ne ze zapsaného seznamu: ten by po přidání skupiny zůstal
    // zelený a job v CI by spadl.
    const dirs = (await readdir(path.join(packageRoot, 'fixtures'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs).toEqual([
      'compiled',
      'crypto',
      'liquid',
      'markers',
      'message-id',
      'outbox',
      'token',
    ]);

    const schemas = new Set(await readdir(path.join(packageRoot, 'schema')));
    const missing = dirs.filter((dir) => !schemas.has(`${dir}.schema.json`));
    expect(missing, `skupiny bez schématu: ${missing.join(', ')}`).toEqual([]);
  });

  it('má i dvě schémata mimo skupiny fixtures a generovaný manifest sloupců', async () => {
    const schemas = await readdir(path.join(packageRoot, 'schema'));
    expect(schemas).toContain('config.schema.json'); // popisuje config.json v kořeni balíčku
    expect(schemas).toContain('columns.schema.json'); // popisuje schema/columns.json
    expect(schemas).toContain('columns.json'); // GENEROVANÝ, čte ho tools/ci/contracts-schema.mjs
  });

  it('všechny fixtures projdou validací proti schématu', async () => {
    const result = await validateAllFixtures(packageRoot);
    expect(result.errors).toEqual([]);
    // Součet podle skutečného obsahu adresářů, ne odhad. Přepočítáno
    // příkazem `for d in fixtures/*/; do find "$d" -name '*.json' | wc -l; done`:
    //   liquid 57, compiled 18, markers 10, token 1, crypto 1, message-id 1,
    //   outbox 1, plus columns.json = 90.
    //
    // Osmnáct fixtur `CT-*` v `compiled` dodal až P08, protože jako jediné má
    // blokový model a renderer, tedy jako jediné je umí vyrobit (rozhodnutí R3).
    // Do té doby jich tu bylo nula a součet byl 70.
    //
    // Liquid fixtur bylo 55; LQ-704 a LQ-705 přidal kořen `data` z transakčního
    // volání. Žádná stávající fixture se nezměnila.
    expect(result.validated).toBe(90);
  });

  it('fixture s neznámým polem neprojde', async () => {
    const result = await validateAllFixtures(packageRoot, {
      extra: [
        { file: 'umely.json', schema: 'liquid', data: { id: 'LQ-999', template: 'x', vymysl: 1 } },
      ],
    });
    expect(result.errors.join('\n')).toContain('umely.json');
  });
});
