import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';

/**
 * Počet migrací se ČTE Z ŽURNÁLU, ne píše natvrdo.
 *
 * Natvrdo tu bylo číslo 7 a bylo zastaralé o tři migrace, takže test padal
 * i bez jediné změny v tomhle souboru a nikdo z toho nepoznal, jestli se
 * rozbil downgrade guard, nebo jen přibyla migrace. Jméno testu přitom říká
 * „rovné počtu migrací", tak ať to opravdu měří.
 */
function migrationCount(): number {
  const journal = fileURLToPath(new URL('../migrations/meta/_journal.json', import.meta.url));
  const parsed = JSON.parse(readFileSync(journal, 'utf8')) as { entries: unknown[] };
  return parsed.entries.length;
}

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('system_settings', () => {
  it('existuje právě jeden řádek', async () => {
    const { rows } = await h
      .as('mlain_app')
      .query<{ n: number }>('SELECT count(*)::int AS n FROM system_settings');
    expect(rows[0].n).toBe(1);
  });

  it('druhý řádek nejde vložit', async () => {
    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO system_settings (id, schema_version, secret_key_fingerprint)
         VALUES (false, 0, '')`,
      ),
    ).rejects.toThrow();
  });

  it('runner do něj zapsal schema_version rovné počtu migrací', async () => {
    const { rows } = await h
      .as('mlain_app')
      .query<{ schema_version: number }>(
        'SELECT schema_version FROM system_settings WHERE id = true',
      );
    expect(rows[0].schema_version).toBe(migrationCount());
  });

  it('aplikační role NESMÍ přepsat schema_version ani řádek smazat', async () => {
    // Bez tohohle omezení si instalace umí vypnout ochranu proti downgradu
    // sama a runner pak pustí starší schéma nad novějšími daty.
    await expect(
      h.as('mlain_app').query('UPDATE system_settings SET schema_version = 1 WHERE id = true'),
    ).rejects.toThrow(/permission denied/i);
    await expect(h.as('mlain_app').query('DELETE FROM system_settings')).rejects.toThrow(
      /permission denied/i,
    );
    // Sloupce, které aplikace plnit MUSÍ, zůstávají zapisovatelné.
    await expect(
      h.as('mlain_app').query(
        `UPDATE system_settings SET secret_key_fingerprint = 'abc', updated_at = now()
        WHERE id = true`,
      ),
    ).resolves.toBeDefined();
  });

  it('tabulka pokolení klíče existuje a je prázdná (plní ji setup, ne migrace)', async () => {
    const { rows } = await h
      .as('mlain_app')
      .query<{ n: number }>('SELECT count(*)::int AS n FROM secret_key_generations');
    expect(rows[0].n).toBe(0);
  });

  it('sloupec settings existuje a je jsonb (rozhodnutí R7)', async () => {
    const { rows } = await h.as('mlain_app').query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'system_settings' AND column_name = 'settings'`,
    );
    expect(rows[0].data_type).toBe('jsonb');
  });
});
