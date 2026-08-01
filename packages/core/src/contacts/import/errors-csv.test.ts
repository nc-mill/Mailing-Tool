import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { buildErrorsCsv } from './errors-csv';

const header = ['Email', 'Jméno'];
const rows = [
  {
    rowNumber: 4312,
    rawLine: 'jana@@firma.cz;Jana',
    errorCode: 'email_invalid',
    errorDetail: 'two at signs',
  },
  { rowNumber: 5001, rawLine: ';Petr', errorCode: 'email_missing', errorDetail: null },
];

describe('errors.csv', () => {
  it('keeps the original header, encoding and delimiter and appends two columns', async () => {
    const buf = await buildErrorsCsv({ header, rows, encoding: 'windows-1250', delimiter: ';' });
    const text = iconv.decode(buf, 'windows-1250');
    expect(text.split('\n')[0]).toBe('Email;Jméno;_error_code;_error_detail');
    expect(text).toContain('jana@@firma.cz;Jana;email_invalid;two at signs');
  });

  it('never translates the added column names', async () => {
    const buf = await buildErrorsCsv({
      header,
      rows,
      encoding: 'utf-8',
      delimiter: ',',
      locale: 'cs',
    });
    expect(buf.toString('utf8')).toContain('_error_code,_error_detail');
    expect(buf.toString('utf8')).not.toContain('kod_chyby');
  });

  it('prefixes a formula cell with an apostrophe', async () => {
    const buf = await buildErrorsCsv({
      header: ['Email'],
      encoding: 'utf-8',
      delimiter: ';',
      rows: [
        {
          rowNumber: 1,
          rawLine: "=cmd|'/c calc'!A1",
          errorCode: 'email_invalid',
          errorDetail: null,
        },
      ],
    });
    expect(buf.toString('utf8')).toContain("'=cmd");
  });

  it('replaces characters missing from windows-1250 and reports the loss', async () => {
    const out = await buildErrorsCsv(
      {
        // Hlavička musí mít tolik sloupců, kolik jich má syrový řádek: záznam se
        // ořezává na šířku hlavičky, aby se opravený soubor dal nahrát zpátky
        // beze změny mapování. S jednosloupcovou hlavičkou by se druhá buňka
        // zahodila a test na ztrátu znaků by neměl co ztratit.
        header: ['Email', 'Jméno'],
        encoding: 'windows-1250',
        delimiter: ';',
        rows: [
          {
            rowNumber: 1,
            rawLine: 'jana@x.cz;日本',
            errorCode: 'email_invalid',
            errorDetail: null,
          },
        ],
      },
      { reportLoss: true },
    );
    expect(out.warnings).toContain('characters_lost');
  });
});
