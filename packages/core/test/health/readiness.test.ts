import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildReadiness,
  dataDirCheck,
  databaseCheck,
  schemaCheck,
} from '../../src/health/readiness';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-health-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('readiness', () => {
  it('vrátí ok, když projdou všechny kontroly', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'database', status: 'ok' }),
      async () => ({ name: 'data_dir', status: 'ok' }),
    ]);
    expect(result.status).toBe('ok');
    expect(result.httpStatus).toBe(200);
    expect(result.checks).toHaveLength(2);
  });

  it('vrátí 503, když jedna kontrola selže', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'database', status: 'fail', detail: 'connection refused' }),
      async () => ({ name: 'data_dir', status: 'ok' }),
    ]);
    expect(result.status).toBe('fail');
    expect(result.httpStatus).toBe(503);
  });

  it('status skip readiness nesráží', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'schema', status: 'skip', detail: 'no migrations yet' }),
    ]);
    expect(result.httpStatus).toBe(200);
  });

  it('status warn readiness nesráží, ale je vidět v odpovědi', async () => {
    const result = await buildReadiness([
      async () => ({
        name: 'secret_key',
        status: 'warn',
        detail: 'secret_key_fingerprint_mismatch',
      }),
    ]);
    expect(result.httpStatus).toBe(200);
    expect(result.checks[0]?.status).toBe('warn');
  });

  it('kontrola, která vyhodí výjimku, se počítá jako fail, ne jako pád probe', async () => {
    const result = await buildReadiness([
      async () => {
        throw new Error('boom');
      },
    ]);
    expect(result.httpStatus).toBe(503);
    expect(result.checks[0]?.detail).toContain('boom');
  });

  it('databaseCheck selže na nedostupné databázi do timeoutu', async () => {
    const check = databaseCheck({
      connectionString: 'postgres://nobody@127.0.0.1:1/none',
      timeoutMs: 300,
    });
    const result = await check();
    expect(result.status).toBe('fail');
    expect(result.name).toBe('database');
  });

  it('schemaCheck hlásí skip, když system_settings neexistuje (rozhodnutí D3)', async () => {
    const result = await schemaCheck({
      query: async () => {
        const error = new Error('relation "system_settings" does not exist') as Error & {
          code: string;
        };
        error.code = '42P01';
        throw error;
      },
      expectedVersion: 0,
    })();
    expect(result.status).toBe('skip');
  });

  it('schemaCheck selže při neshodě verze', async () => {
    const result = await schemaCheck({
      query: async () => 41,
      expectedVersion: 42,
    })();
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('42');
  });

  it('schemaCheck hlásí schema_version_ahead, když je databáze novější', async () => {
    const result = await schemaCheck({ query: async () => 43, expectedVersion: 42 })();
    expect(result.detail).toContain('schema_version_ahead');
  });

  it('dataDirCheck selže, když adresář není zapisovatelný', async () => {
    const readonly = path.join(tmp, 'ro');
    fs.mkdirSync(readonly);
    fs.chmodSync(readonly, 0o500);
    try {
      expect((await dataDirCheck(readonly)()).status).toBe('fail');
    } finally {
      fs.chmodSync(readonly, 0o700);
    }
    expect((await dataDirCheck(tmp)()).status).toBe('ok');
  });
});
