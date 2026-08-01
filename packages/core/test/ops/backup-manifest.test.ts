import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_ROW_COUNT_TABLES,
  compareRowCounts,
  isBackupFromNewerVersion,
  parseManifest,
} from '../../src/ops/backup-manifest';

const valid = {
  format_version: 1,
  created_at: '2026-07-31T03:00:00.000Z',
  app_version: '1.0.0',
  schema_version: 42,
  installation_id: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  secret_key_fingerprint: 'VXGoNjoPSBY',
  postgres_version: '18.4',
  database: { bytes: 184320000, sha256: 'a'.repeat(64) },
  uploads: { bytes: 42000000, sha256: 'b'.repeat(64), files: 1284 },
  row_counts: { contacts: 48211 },
};

describe('parseManifest', () => {
  it('přijme manifest ze specifikace 3.14', () => {
    expect(parseManifest(valid).schema_version).toBe(42);
  });

  it('odmítne neznámou format_version', () => {
    expect(() => parseManifest({ ...valid, format_version: 2 })).toThrow(/format_version/);
  });

  it('odmítne sha256, které není 64 hexadecimálních znaků', () => {
    expect(() => parseManifest({ ...valid, database: { bytes: 1, sha256: 'krátké' } })).toThrow();
  });

  it('odmítne manifest bez počtu kontaktů', () => {
    expect(() => parseManifest({ ...valid, row_counts: {} })).toThrow(/contacts/);
  });
});

describe('isBackupFromNewerVersion', () => {
  it.each([
    ['1.0.0', '1.0.0', false],
    ['0.9.9', '1.0.0', false],
    ['1.0.1', '1.0.0', true],
    ['2.0.0', '1.10.0', true],
    ['1.10.0', '1.9.0', true],
    ['1.0.0-dev', '1.0.0', false],
  ])('%s proti image %s je %s', (backup, image, expected) => {
    expect(isBackupFromNewerVersion(backup as string, image as string)).toBe(expected);
  });
});

describe('compareRowCounts', () => {
  it('nenajde rozdíl u shodných počtů', () => {
    expect(compareRowCounts({ contacts: 5 }, { contacts: 5 })).toEqual([]);
  });

  it('najde rozdíl a pojmenuje tabulku', () => {
    expect(compareRowCounts({ contacts: 5, users: 1 }, { contacts: 4, users: 1 })).toEqual([
      { table: 'contacts', expected: 5, actual: 4 },
    ]);
  });

  it('chybějící tabulku hlásí jako nulu', () => {
    expect(compareRowCounts({ contacts: 5 }, {})).toEqual([
      { table: 'contacts', expected: 5, actual: 0 },
    ]);
  });
});

describe('BACKUP_ROW_COUNT_TABLES', () => {
  it('obsahuje contacts, protože na tom stojí akceptační kritérium 9', () => {
    expect(BACKUP_ROW_COUNT_TABLES).toContain('contacts');
  });

  it('je bez duplicit', () => {
    expect(new Set(BACKUP_ROW_COUNT_TABLES).size).toBe(BACKUP_ROW_COUNT_TABLES.length);
  });

  it('formát manifestu je verze 1', () => {
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });
});
