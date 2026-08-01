import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { readRows, type RawRow } from './reader';
import type { Dialect } from './dialect';
import type { DetectedEncoding } from './encoding';

const dir = mkdtempSync(join(tmpdir(), 'mlain-reader-'));

function fixture(name: string, content: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const dialect: Dialect = {
  delimiter: ';',
  quoteChar: '"',
  escape: 'double',
  hasHeader: true,
  columnCount: 2,
};
const encoding: DetectedEncoding = { encoding: 'utf-8', source: 'utf8_validation', bomLength: 0 };

async function collect(path: string, extra: Partial<Parameters<typeof readRows>[1]> = {}) {
  const rows: RawRow[] = [];
  for await (const row of readRows(path, {
    dialect,
    encoding,
    maxCellChars: 100,
    maxLineBytes: 1000,
    ...extra,
  })) {
    rows.push(row);
  }
  return rows;
}

describe('streaming reader', () => {
  it('yields rows with a one based data row number and a byte offset', async () => {
    const path = fixture('a.csv', Buffer.from('email;name\na@x.cz;A\nb@x.cz;B\n', 'utf8'));
    const seen = await collect(path);
    expect(seen.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(seen[0]?.fields).toEqual(['a@x.cz', 'A']);
    expect(seen[1]?.byteOffsetAfter).toBe(29);
  });

  it('resumes from a byte offset without re-reading earlier rows', async () => {
    const path = fixture('b.csv', Buffer.from('email;name\na@x.cz;A\nb@x.cz;B\n', 'utf8'));
    const seen = await collect(path, { startByte: 20, startRowNumber: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.fields[0]).toBe('b@x.cz');
    expect(seen[0]?.rowNumber).toBe(2);
  });

  it('decodes windows-1250 correctly', async () => {
    const path = fixture('c.csv', iconv.encode('email;name\nj@x.cz;Šťastná\n', 'windows-1250'));
    const rows: RawRow[] = [];
    for await (const row of readRows(path, {
      dialect,
      encoding: { encoding: 'windows-1250', source: 'score', bomLength: 0 },
      maxCellChars: 100,
      maxLineBytes: 1000,
    })) {
      rows.push(row);
    }
    expect(rows[0]?.fields[1]).toBe('Šťastná');
  });

  it('flags a row with a different field count', async () => {
    const path = fixture('d.csv', Buffer.from('email;name\na@x.cz;A;extra\n', 'utf8'));
    const rows = await collect(path);
    expect(rows[0]?.fieldCountMismatch).toBe(true);
  });

  it('pads missing trailing fields and warns instead of failing', async () => {
    const path = fixture('e.csv', Buffer.from('email;name\na@x.cz\n', 'utf8'));
    const rows = await collect(path);
    expect(rows[0]?.fields).toEqual(['a@x.cz', '']);
    expect(rows[0]?.padded).toBe(true);
  });

  it('reports the header row separately', async () => {
    const path = fixture('f.csv', Buffer.from('email;name\na@x.cz;A\n', 'utf8'));
    let header: string[] | undefined;
    await collect(path, {
      onHeader: (h) => {
        header = h;
      },
    });
    expect(header).toEqual(['email', 'name']);
  });
});
