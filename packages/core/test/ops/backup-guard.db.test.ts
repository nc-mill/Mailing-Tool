import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { grantReadAllData } from '../support/pg-superuser';
import { assertDumpRoleSeesAllRows, DumpRoleBlindError } from '../../src/ops/backup-guard';

const run = promisify(execFile);
let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
  await grantReadAllData(pg.ownerUrl);
  await pg.seedMinimalInstallation({ contacts: 3 });
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe('assertDumpRoleSeesAllRows', () => {
  it('projde pod migrátorem, který vlastní schéma', async () => {
    await expect(
      assertDumpRoleSeesAllRows(pg.urlForRole('mlain_migrator')),
    ).resolves.toBeUndefined();
  });

  it('spadne pod aplikační rolí, na kterou platí RLS', async () => {
    await expect(assertDumpRoleSeesAllRows(pg.urlForRole('mlain_app'))).rejects.toThrow(
      DumpRoleBlindError,
    );
  });

  it('spadne pod mlain_backup, protože pg_read_all_data není BYPASSRLS', async () => {
    await expect(assertDumpRoleSeesAllRows(pg.urlForRole('mlain_backup'))).rejects.toThrow(
      DumpRoleBlindError,
    );
  });

  it('hláška jmenuje roli i konkrétní tabulku, aby šlo jednat', async () => {
    const err = await assertDumpRoleSeesAllRows(pg.urlForRole('mlain_app')).catch(
      (e: Error) => e,
    );
    expect(err.message).toContain('mlain_app');
    expect(err.message).toContain('contacts');
  });

  it('jmenuje i partitionované tabulky, na které RLS sedí na rodiči', async () => {
    // messages má relkind 'p', ne 'r'. Dotaz zúžený na 'r' by devět největších
    // tabulek přeskočil a pojistka by mlčela právě u nich. Ověřeno spuštěním:
    // relkind='r' najde jen contacts, relkind IN ('r','p') najde i messages.
    const err = await assertDumpRoleSeesAllRows(pg.urlForRole('mlain_app')).catch(
      (e: Error) => e,
    );
    expect(err.message).toContain('messages');
  });
});

describe('skutečné chování pg_dump, na kterém pojistka stojí', () => {
  // Tenhle blok se NEPTÁ našeho zdrojáku. Spouští pg_dump a měří, co udělá.
  // Bez něj by pojistka chránila před chováním, které si někdo jen pamatuje.
  it('pod rolí s RLS spadne hlasitě, nevyrobí tichou prázdnou zálohu', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'guard-'));
    const result = await run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      join(dir, 'x.dump'),
      pg.urlForRole('mlain_backup'),
    ]).then(
      () => ({ code: 0, stderr: '' }),
      (e: { code: number; stderr: string }) => e,
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('row-level security');
  });

  it('s --enable-row-security naopak projde a vyrobí prázdné tabulky', async () => {
    // Tohle je ta tichá porucha. Test ji drží viditelnou, aby nikdo ten
    // přepínač nedopsal do runBackup jako „opravu" padající noční zálohy.
    const dir = await mkdtemp(join(tmpdir(), 'guard-'));
    const dump = join(dir, 'blind.dump');
    await run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--enable-row-security',
      '--file',
      dump,
      pg.urlForRole('mlain_backup'),
    ]);
    const { stdout } = await run('pg_restore', [
      '--data-only',
      '--table=contacts',
      '-f',
      '-',
      dump,
    ]);
    expect(stdout).not.toContain('@example.test');
  });

  it('runBackup ten přepínač nikdy nepoužije', async () => {
    const source = await readFile(new URL('../../src/ops/backup.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('enable-row-security');
  });
});
