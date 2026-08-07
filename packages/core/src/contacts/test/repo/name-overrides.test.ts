import { describe, expect, it } from 'vitest';
import {
  listNameOverrides,
  upsertNameOverride,
  type NameOverride,
} from '../../repo/name-overrides';
import { testContext } from '../support/db';
import type { WorkspaceContext } from '../../../identity/types';

/**
 * Zápis přepisu jména musí odlišit „nevyplněno" od „vymaž".
 *
 * Do 7. 8. 2026 to neuměl: `ON CONFLICT` dosazoval
 * `coalesce(excluded.x, name_overrides.x)`, takže vynechané pole i výslovné `null`
 * dopadly stejně a znamenaly „nech, jak bylo". Špatný pátý pád tedy z přepisu
 * nešlo odstranit; jediná cesta byla smazat celý řádek a založit ho znovu, a to
 * obrazovka přepisů musela uživateli říkat jako výmluvu.
 */

async function readOne(ctx: WorkspaceContext, nameKey: string): Promise<NameOverride> {
  const rows = await listNameOverrides(ctx, { q: nameKey });
  const row = rows.find((candidate) => candidate.name_key === nameKey);
  expect(row).toBeDefined();
  return row!;
}

describe('přepisy jmen: vynechané pole proti vymazání', () => {
  it('vynechané pole nechá hodnotu, jak byla', async () => {
    const ctx = await testContext();
    await upsertNameOverride(ctx, {
      kind: 'first',
      name: 'Nikola',
      gender: 'female',
      vocative: 'Nikolo',
      note: 'z importu',
    });

    // Volání, které o vokativ ani poznámku nezavadí. Přesně tak se chová fronta
    // kontroly oslovení u akce `set_gender`.
    await upsertNameOverride(ctx, { kind: 'first', name: 'Nikola', gender: 'male' });

    const row = await readOne(ctx, 'nikola');
    expect(row.gender).toBe('male');
    expect(row.vocative).toBe('Nikolo');
    expect(row.note).toBe('z importu');
  });

  it('výslovné null hodnotu vymaže', async () => {
    const ctx = await testContext();
    await upsertNameOverride(ctx, {
      kind: 'first',
      name: 'Nikola',
      gender: 'female',
      vocative: 'Nikoli',
      note: 'překlep',
    });

    await upsertNameOverride(ctx, {
      kind: 'first',
      name: 'Nikola',
      gender: 'female',
      vocative: null,
      note: null,
    });

    const row = await readOne(ctx, 'nikola');
    expect(row.gender).toBe('female');
    expect(row.vocative).toBeNull();
    expect(row.note).toBeNull();
  });

  it('diakritika ani velikost písmen nerozhodují, mění se týž řádek', async () => {
    const ctx = await testContext();
    await upsertNameOverride(ctx, { kind: 'first', name: 'Tomáš', vocative: 'Tomasi' });
    await upsertNameOverride(ctx, { kind: 'first', name: 'tomas', vocative: 'Tomáši' });

    const rows = await listNameOverrides(ctx, { kind: 'first' });
    expect(rows.filter((row) => row.name_key === 'tomas')).toHaveLength(1);
    expect((await readOne(ctx, 'tomas')).vocative).toBe('Tomáši');
  });

  it('vymazání poslední zbývající hodnoty se odmítne, řádek zůstane celý', async () => {
    const ctx = await testContext();
    await upsertNameOverride(ctx, { kind: 'first', name: 'Nikola', vocative: 'Nikolo' });

    // Bez kontroly nad VÝSLEDKEM by tohle prošlo do databáze a spadlo až na
    // `ck_name_overrides__has_value`, tedy chybou 23514 a odpovědí 500.
    await expect(
      upsertNameOverride(ctx, { kind: 'first', name: 'Nikola', vocative: null }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    expect((await readOne(ctx, 'nikola')).vocative).toBe('Nikolo');
  });

  it('založení bez rodu i vokativu se odmítne', async () => {
    const ctx = await testContext();
    await expect(
      upsertNameOverride(ctx, { kind: 'last', name: 'Novák', note: 'jen poznámka' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await listNameOverrides(ctx, { kind: 'last' })).toHaveLength(0);
  });

  it('druh jména je součást klíče, křestní a příjmení se nepřepisují navzájem', async () => {
    const ctx = await testContext();
    await upsertNameOverride(ctx, { kind: 'first', name: 'Nikola', vocative: 'Nikolo' });
    await upsertNameOverride(ctx, { kind: 'last', name: 'Nikola', vocative: 'Nikolovi' });

    const rows = await listNameOverrides(ctx, { q: 'nikola' });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.kind === 'first')?.vocative).toBe('Nikolo');
    expect(rows.find((row) => row.kind === 'last')?.vocative).toBe('Nikolovi');
  });
});
