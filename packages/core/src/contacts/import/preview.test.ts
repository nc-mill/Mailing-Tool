import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPreview } from './preview';
import { estimateFile, type EstimateContext } from './estimate';
import { defaultOptions } from './options';
import { EMPTY_OVERRIDES } from '../naming/types';

const dir = mkdtempSync(join(tmpdir(), 'mlain-preview-'));

/**
 * Fixtury se generují, ne commitují: `big.csv` má šest set tisíc řádků a soubor
 * té velikosti nemá v repozitáři co dělat.
 */
function write(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

const NAMES = ['Jana Nováková', 'Petr Šťastný', 'Nikola Krátký', 'Lucie Žáková'];

const twelveK = write(
  '12k.csv',
  `Email;Jméno\n${Array.from(
    { length: 12_479 },
    (_, i) => `c${i}@firma.cz;${NAMES[i % NAMES.length]}`,
  ).join('\n')}\n`.replace('c0@firma.cz', 'jana@firma.cz'),
);

const titles = write('titles.csv', 'Email;Jméno\npavel@firma.cz;Ing. Pavel Novák\n');

const mixed = write(
  'mixed.csv',
  'Email;Jméno\nok@firma.cz;Jana Nováková\nbad@@firma.cz;Karel Vomáčka\nblocked@firma.cz;Petr Malý\n',
);

const big = write(
  'big.csv',
  `Email;Jméno\n${Array.from({ length: 600 }, (_, i) => `b${i}@firma.cz;Jana Nováková`).join('\n')}\n`,
);

function previewCtx(): EstimateContext {
  return {
    mapping: { '0': { target: 'email' }, '1': { target: 'full_name' } },
    options: defaultOptions(),
    fieldCatalog: {},
    settings: {
      locale: 'cs',
      addressForm: 'formal',
      salutationBy: 'first_name',
      vocativePolicy: 'balanced',
    },
    overrides: EMPTY_OVERRIDES,
    suppressed: new Map([['blocked@firma.cz', 'complaint']]),
    dialect: { delimiter: ';', quoteChar: '"', escape: 'double', hasHeader: true, columnCount: 2 },
    encoding: { encoding: 'utf-8', source: 'utf8_validation', bomLength: 0 },
    maxCellChars: 8192,
    maxLineBytes: 65_536,
    existingEmails: new Set<string>(),
  };
}

describe('preview and estimate', () => {
  it('shows twenty rows in their final shape with the greeting column', async () => {
    const out = await buildPreview(twelveK, previewCtx());
    expect(out.rows).toHaveLength(20);
    expect(out.rows[0]?.greeting).toBe('Dobrý den, Jano');
    expect(out.rows[0]?.title_prefix).toBeNull();
  });

  it('shows Ing. Pavel Novák as title, first name, last name and Dobrý den, Pavle', async () => {
    const out = await buildPreview(titles, previewCtx());
    const row = out.rows.find((r) => r.email.startsWith('pavel'));
    expect(row).toMatchObject({
      title_prefix: 'Ing.',
      first_name: 'Pavel',
      last_name: 'Novák',
      greeting: 'Dobrý den, Pavle',
    });
  });

  it('marks failing rows red and suppressed rows grey', async () => {
    const out = await buildPreview(mixed, previewCtx());
    expect(out.rows.some((r) => r.state === 'error')).toBe(true);
    expect(out.rows.some((r) => r.state === 'suppressed')).toBe(true);
  });

  it('counts data rows, never the header', async () => {
    const out = await estimateFile(twelveK, previewCtx());
    expect(out.totalRows).toBe(12_479);
    expect(out.approximate).toBe(false);
  });

  it('extrapolates above the exact scan limit and says so', async () => {
    const out = await estimateFile(big, { ...previewCtx(), exactScanLimit: 100 });
    expect(out.approximate).toBe(true);
  });

  it('reports how many contacts will end up in the review queue', async () => {
    const out = await estimateFile(twelveK, previewCtx());
    expect(out.reviewRows).toBeGreaterThan(0);
  });
});
