import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findMigrationsFolderFrom,
  isMigrationsFolder,
  MigrationsFolderNotFoundError,
  resolveMigrationsFolder,
} from '../src/migrations-folder';
import { runMigrations } from '../src/migrate';

/**
 * Testy k cestě na adresář s migracemi. ŽÁDNÝ z nich nepotřebuje Postgres,
 * proto jsou v projektu `unit` (viz `vitest.config.ts`): kdyby potřebovaly
 * kontejner, nikdo by je při ladění nespouštěl a pojistka by zplaněla.
 *
 * Hlídají vadu, která se v produktu objevila třikrát za sebou: obnova ze
 * zálohy, upgrade a nedělní ověření zálohy si cestu k migracím neuměly složit
 * v zabundlované aplikaci, migrace spadla na ENOENT a za ní se PŘESKOČILO
 * volání `mlain_apply_grants()`. Obnovená databáze pak hlásila
 * `permission denied for table contacts`.
 */

/** Rozložení hotové image: `/app/apps/cli/dist` vedle `/app/packages/db/migrations`. */
function makeImageLayout(): { root: string; migrations: string } {
  const root = mkdtempSync(join(tmpdir(), 'mlain-migrations-'));
  const migrations = join(root, 'packages', 'db', 'migrations');
  mkdirSync(join(migrations, 'meta'), { recursive: true });
  writeFileSync(join(migrations, 'meta', '_journal.json'), '{"entries":[]}');
  mkdirSync(join(root, 'apps', 'cli', 'dist'), { recursive: true });
  mkdirSync(join(root, 'apps', 'worker', 'dist'), { recursive: true });
  return { root, migrations };
}

describe('hledání adresáře s migracemi', () => {
  it('najde migrace z bundlu CLI, tedy z jiné hloubky, než ve které leží zdroje', () => {
    const { root, migrations } = makeImageLayout();
    expect(findMigrationsFolderFrom(join(root, 'apps', 'cli', 'dist'))).toBe(migrations);
  });

  it('najde je i z bundlu workeru, kvůli nedělnímu ověření zálohy', () => {
    const { root, migrations } = makeImageLayout();
    expect(findMigrationsFolderFrom(join(root, 'apps', 'worker', 'dist'))).toBe(migrations);
  });

  it('najde je i ze zdrojů, kde je hloubka jiná než v bundlu', () => {
    const { root, migrations } = makeImageLayout();
    mkdirSync(join(root, 'packages', 'db', 'src'), { recursive: true });
    expect(findMigrationsFolderFrom(join(root, 'packages', 'db', 'src'))).toBe(migrations);
  });

  it('adresář bez meta/_journal.json se za adresář s migracemi NEPOVAŽUJE', () => {
    const root = mkdtempSync(join(tmpdir(), 'mlain-migrations-'));
    const fake = join(root, 'packages', 'db', 'migrations');
    mkdirSync(fake, { recursive: true });
    expect(isMigrationsFolder(fake)).toBe(false);
    expect(() => findMigrationsFolderFrom(join(root, 'apps', 'cli', 'dist'))).toThrow(
      MigrationsFolderNotFoundError,
    );
  });

  it('když se nenajde nic, chyba vyjmenuje prohledané cesty a poradí MIGRATIONS_DIR', () => {
    const root = mkdtempSync(join(tmpdir(), 'mlain-migrations-'));
    try {
      findMigrationsFolderFrom(root);
      expect.unreachable('mělo vyhodit MigrationsFolderNotFoundError');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationsFolderNotFoundError);
      const err = error as MigrationsFolderNotFoundError;
      expect(err.searched[0]).toBe(join(root, 'packages', 'db', 'migrations'));
      expect(err.message).toContain('MIGRATIONS_DIR');
    }
  });
});

describe('resolveMigrationsFolder', () => {
  it('MIGRATIONS_DIR má přednost a NEOVĚŘUJE se proti disku', () => {
    expect(resolveMigrationsFolder({ MIGRATIONS_DIR: '/nikde/takovem/miste' })).toBe(
      '/nikde/takovem/miste',
    );
  });

  it('prázdný MIGRATIONS_DIR se ignoruje, jinak by přebil platné odvození', () => {
    expect(isMigrationsFolder(resolveMigrationsFolder({ MIGRATIONS_DIR: '' }))).toBe(true);
  });

  it('v tomhle repozitáři vrací adresář, který opravdu obsahuje žurnál', () => {
    const folder = resolveMigrationsFolder({});
    expect(isMigrationsFolder(folder)).toBe(true);
  });
});

describe('runMigrations bez použitelné cesty', () => {
  /**
   * Kontrola cesty je PŘED připojením k databázi, proto tyhle testy nepotřebují
   * Postgres: kdyby se k němu runner dostal, spadl by na nedostupné adrese
   * a chyba by nebyla `migrations_folder_invalid`.
   */
  const unreachable = 'postgres://nikdo@127.0.0.1:1/nic';

  it('prázdná cesta skončí srozumitelnou MigrationError, ne syrovým ENOENT', async () => {
    await expect(runMigrations({ url: unreachable, migrationsFolder: '' })).rejects.toMatchObject({
      name: 'MigrationError',
      code: 'migrations_folder_invalid',
      exitCode: 78,
    });
  });

  it('adresář bez žurnálu skončí stejně a hláška poradí MIGRATIONS_DIR', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mlain-migrations-'));
    await expect(runMigrations({ url: unreachable, migrationsFolder: root })).rejects.toThrow(
      /MIGRATIONS_DIR/,
    );
  });
});
