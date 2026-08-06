import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asMigrationFailure, reportMigrationFailure } from '../../src/commands/migration-failure';
import type { CliStreams } from '../../src/dispatch';

/**
 * Selhaná migrace nesmí z CLI vypadnout jako pád procesu.
 *
 * `mlain migrate` vracel 3, 4, 5 a 75 od začátku. `mlain restore` a
 * `mlain upgrade` volají týž runner, ale `MigrationError` pouštěly ven:
 * `dispatch` ji nechytá, `main.ts` taky ne, takže proces skončil kódem 1
 * a stackem. U obnovy je to nejhorší možná chvíle, protože za migrací stojí
 * `mlain_apply_grants()` a při pádu se PŘESKOČÍ.
 */

/** Věrná napodobenina chyby runneru. Tvar odpovídá `MigrationError`. */
function migrationError(message: string, exitCode: number, code: string): Error {
  const error = new Error(message);
  error.name = 'MigrationError';
  Object.assign(error, { exitCode, code });
  return error;
}

const io = (): CliStreams & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (l) => out.push(l), stderr: (l) => err.push(l) };
};

vi.mock('@mlain/core/ops', () => ({
  restoreBackup: vi.fn(),
  runUpgrade: vi.fn(),
  loadOpsKeyring: () => ({ currentFingerprint: 'ff'.repeat(8) }),
  keyringEnvFromConfig: () => ({}),
  RestoreRefusedError: class RestoreRefusedError extends Error {},
  ProcessesStillRunningError: class ProcessesStillRunningError extends Error {},
}));

/** Nejmenší platná konfigurace; `DATA_DIR` musí existovat, ostatní cesty se z něj odvodí. */
const dataDir = mkdtempSync(join(tmpdir(), 'mlain-cli-'));
const env = {
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: `1:${Buffer.alloc(32, 7).toString('base64url')}`,
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATABASE_URL_MIGRATOR: 'postgres://mlain_migrator:pw@localhost:5432/mlain',
  DATA_DIR: dataDir,
};

describe('rozpoznání selhané migrace', () => {
  it('pozná chybu runneru podle tvaru, ne přes instanceof', () => {
    expect(
      asMigrationFailure(migrationError('migrace 0007 spadla', 3, 'migration_failed')),
    ).toEqual({ message: 'migrace 0007 spadla', exitCode: 3, code: 'migration_failed' });
  });

  it('obyčejnou chybu nepovažuje za migrační, aby ji volající pustil dál', () => {
    expect(asMigrationFailure(new Error('ECONNREFUSED'))).toBeNull();
    const withoutCode = new Error('nic');
    withoutCode.name = 'MigrationError';
    expect(asMigrationFailure(withoutCode)).toBeNull();
  });

  it('vypíše hlášku runneru i následky a vrátí exit kód', () => {
    const streams = io();
    const code = reportMigrationFailure(streams, migrationError('zámek', 75, 'lock'), ['následek']);
    expect(code).toBe(75);
    expect(streams.err[0]).toContain('zámek');
    expect(streams.err).toContain('následek');
  });
});

describe('mlain restore při selhané migraci', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vrátí exit kód runneru a řekne, že granty NEPROBĚHLY', async () => {
    const ops = await import('@mlain/core/ops');
    vi.mocked(ops.restoreBackup).mockRejectedValue(
      migrationError('migrace 0021 spadla na syntax error', 3, 'migration_failed'),
    );
    const { runRestoreCommand } = await import('../../src/commands/restore');
    const streams = io();

    const code = await runRestoreCommand(streams, ['/data/backups/2026-08-06'], env);

    expect(code).toBe(3);
    expect(streams.err.join('\n')).toContain('migrace 0021 spadla');
    expect(streams.err.join('\n')).toContain('mlain_apply_grants()');
  });

  it('timeout migračního zámku vrací 75, tedy EX_TEMPFAIL, ne 1', async () => {
    const ops = await import('@mlain/core/ops');
    vi.mocked(ops.restoreBackup).mockRejectedValue(
      migrationError('nepodařilo se získat migrační zámek', 75, 'migration_lock_timeout'),
    );
    const { runRestoreCommand } = await import('../../src/commands/restore');

    expect(await runRestoreCommand(io(), ['/data/backups/2026-08-06'], env)).toBe(75);
  });

  it('chybu, která migrační není, pouští dál beze změny', async () => {
    const ops = await import('@mlain/core/ops');
    vi.mocked(ops.restoreBackup).mockRejectedValue(new Error('pg_restore: nenalezen dump'));
    const { runRestoreCommand } = await import('../../src/commands/restore');

    await expect(runRestoreCommand(io(), ['/data/backups/x'], env)).rejects.toThrow(
      'pg_restore: nenalezen dump',
    );
  });
});

describe('mlain upgrade při selhané migraci', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vrátí exit kód runneru místo pádu se stackem', async () => {
    const ops = await import('@mlain/core/ops');
    vi.mocked(ops.runUpgrade).mockRejectedValue(
      migrationError('schema_version 22 je vyšší než maximum 21', 5, 'schema_version_ahead'),
    );
    const { runUpgradeCommand } = await import('../../src/commands/upgrade');
    const streams = io();

    const code = await runUpgradeCommand(streams, [], env);

    expect(code).toBe(5);
    expect(streams.err.join('\n')).toContain('schema_version 22');
    expect(streams.err.join('\n')).toContain('Záloha z tohohle běhu je hotová');
  });
});
