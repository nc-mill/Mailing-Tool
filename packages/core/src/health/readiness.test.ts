import { describe, expect, it } from 'vitest';
import { buildReadiness, dataDirCheck, schemaCheck } from './readiness';
import type { Check } from './types';

/**
 * Tenhle soubor vznikl kvůli konkrétní chybě, ne pro pokrytí.
 *
 * Kontrola schématu vracela při chybějící tabulce `system_settings` stav
 * `skip`. Readiness proto odpověděla 200 nad PRÁZDNOU databází a kontejner
 * se tvářil zdravě, zatímco worker vedle něj padal na „permission denied
 * for database mlain". Modul `health` přitom neměl jediný test, takže tu
 * regresi nemělo co zachytit.
 *
 * Případ „schéma chybí, ale image migrace zná" je tu proto první.
 */

const UNDEFINED_TABLE = '42P01';

function undefinedTableError(): Error {
  const error = new Error('relation "system_settings" does not exist');
  (error as Error & { code: string }).code = UNDEFINED_TABLE;
  return error;
}

describe('schemaCheck', () => {
  it('selže, když system_settings neexistuje a image migrace zná', async () => {
    const check = schemaCheck({
      expectedVersion: 7,
      query: () => Promise.reject(undefinedTableError()),
    });

    const result = await check();

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/není zmigrovaná/);
  });

  it('readiness kvůli chybějícímu schématu vrátí 503, ne 200', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'database', status: 'ok' }),
      schemaCheck({ expectedVersion: 7, query: () => Promise.reject(undefinedTableError()) }),
    ]);

    expect(result.httpStatus).toBe(503);
    expect(result.status).toBe('fail');
  });

  it('přeskočí se jen u buildu bez migrací', async () => {
    const check = schemaCheck({
      expectedVersion: 0,
      query: () => Promise.reject(new Error('sem se to nemá dostat')),
    });

    expect((await check()).status).toBe('skip');
  });

  it('projde, když se verze shodují', async () => {
    const check = schemaCheck({ expectedVersion: 7, query: async () => 7 });

    expect((await check()).status).toBe('ok');
  });

  it('selže, když je databáze napřed proti image', async () => {
    const check = schemaCheck({ expectedVersion: 7, query: async () => 9 });
    const result = await check();

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/schema_version_ahead/);
  });

  it('selže, když je databáze pozadu za image', async () => {
    const check = schemaCheck({ expectedVersion: 7, query: async () => 5 });

    expect((await check()).status).toBe('fail');
  });

  it('jinou chybu databáze nezamlčí', async () => {
    const check = schemaCheck({
      expectedVersion: 7,
      query: () => Promise.reject(new Error('connection terminated')),
    });
    const result = await check();

    expect(result.status).toBe('fail');
    expect(result.detail).toBe('connection terminated');
  });
});

describe('buildReadiness', () => {
  it('vrátí 200, když všechny kontroly projdou', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'database', status: 'ok' }),
      async () => ({ name: 'schema', status: 'ok' }),
    ]);

    expect(result.httpStatus).toBe(200);
    expect(result.status).toBe('ok');
  });

  it('stav skip sám o sobě readiness neshodí', async () => {
    const result = await buildReadiness([async () => ({ name: 'schema', status: 'skip' })]);

    expect(result.httpStatus).toBe(200);
  });

  it('stačí jedna selhaná kontrola z několika', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'database', status: 'ok' }),
      async () => ({ name: 'data_dir', status: 'fail', detail: 'read-only' }),
      async () => ({ name: 'schema', status: 'ok' }),
    ]);

    expect(result.httpStatus).toBe(503);
  });

  // Kontrola, která spadne výjimkou, nesmí shodit celou odpověď. Bez tohohle
  // by /api/health/ready místo 503 vrátil 500 a monitoring by nevěděl, co se
  // vlastně pokazilo.
  it('výjimku uvnitř kontroly převede na fail, ne na pád', async () => {
    const exploding: Check = () => {
      throw new Error('probe explodovala');
    };

    const result = await buildReadiness([exploding]);

    expect(result.httpStatus).toBe(503);
    expect(result.checks[0]?.status).toBe('fail');
    expect(result.checks[0]?.detail).toBe('probe explodovala');
  });

  it('každá kontrola má naměřenou dobu běhu', async () => {
    const result = await buildReadiness([async () => ({ name: 'database', status: 'ok' })]);

    expect(result.checks[0]?.duration_ms).toBeTypeOf('number');
  });
});

describe('dataDirCheck', () => {
  it('selže, když adresář neexistuje', async () => {
    const result = await dataDirCheck('/nonexistent-mlain-data-dir-for-test')();

    expect(result.status).toBe('fail');
  });

  it('projde nad zapisovatelným adresářem', async () => {
    const result = await dataDirCheck(process.env['TMPDIR'] ?? '/tmp')();

    expect(result.status).toBe('ok');
  });
});
