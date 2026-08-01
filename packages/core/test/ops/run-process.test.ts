import { describe, expect, it } from 'vitest';
import { ProcessFailedError, majorVersionOf, runProcess } from '../../src/ops/run-process';

describe('runProcess', () => {
  it('vrátí stdout a nulový kód', async () => {
    const r = await runProcess('node', ['-e', 'process.stdout.write("ahoj")']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('ahoj');
  });

  it('u nenulového kódu hodí ProcessFailedError', async () => {
    await expect(
      runProcess('node', ['-e', 'process.stderr.write("bum"); process.exit(3)']),
    ).rejects.toThrow(ProcessFailedError);
  });

  it('nepouští příkaz přes shell, takže metaznaky jsou obyčejný argument', async () => {
    const r = await runProcess('node', [
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      '; rm -rf /',
    ]);
    expect(r.stdout).toBe('; rm -rf /');
  });

  it('při překročení timeoutu proces zabije a hodí chybu', async () => {
    await expect(
      runProcess('node', ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 }),
    ).rejects.toThrow(/timeout/i);
  });

  it('nezapíše hodnotu tajné proměnné do hlášky chyby', async () => {
    const err = await runProcess('node', ['-e', 'process.exit(1)'], {
      env: { PGPASSWORD: 'tajne-heslo' },
    }).catch((e: Error) => e);
    expect(String(err)).not.toContain('tajne-heslo');
  });
});

describe('majorVersionOf', () => {
  it('vytáhne major verzi z výpisu', () => {
    expect(majorVersionOf('pg_dump (PostgreSQL) 18.4')).toBe(18);
    expect(majorVersionOf('psql (PostgreSQL) 17.2 (Debian)')).toBe(17);
    expect(majorVersionOf('nic o verzi')).toBeNull();
  });
});
