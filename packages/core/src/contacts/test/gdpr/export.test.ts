import { describe, expect, it } from 'vitest';
import { SUBJECT_EXPORT_FILES, escapeCsvCell, toCsv } from '../../gdpr/export';
import { createZip } from '../../gdpr/zip';

describe('KRITÉRIUM 65: obsah exportu', () => {
  it('deset souborů podle tabulky ve 4.14.2', () => {
    expect(SUBJECT_EXPORT_FILES.map((f) => f.name)).toEqual([
      'contact.json',
      'consents.csv',
      'subscriptions.csv',
      'tags.csv',
      'messages.csv',
      'message_events.csv',
      'web_events.ndjson',
      'form_submissions.csv',
      'imports.csv',
      'README.txt',
    ]);
  });

  it('u každého souboru je vidět, která doména ho plní', () => {
    for (const file of SUBJECT_EXPORT_FILES) {
      expect(['contacts', 'campaigns', 'tracking']).toContain(file.owner);
    }
  });
});

describe('ochrana proti CSV injection', () => {
  it.each(['=cmd', '+1', '-1', '@SUM', '\tx', '\rx'])(
    'buňka začínající na %s dostane prefix apostrofu',
    (value) => {
      // Hodnota s \r se navíc uzávorkuje, protože obsahuje konec řádku.
      const escaped = escapeCsvCell(value);
      expect(escaped.replace(/^"|"$/g, '')).toBe(`'${value}`);
    },
  );

  it('běžná hodnota se nemění', () => {
    expect(escapeCsvCell('Jana Nováková')).toBe('Jana Nováková');
  });

  it('hodnota s uvozovkami se uzávorkuje a uvozovky zdvojí', () => {
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });

  it('hodnota s oddělovačem se uzávorkuje', () => {
    expect(escapeCsvCell('a;b')).toBe('"a;b"');
  });

  it('KRITÉRIUM: jméno s HYPERLINK nespustí kód v tabulkovém procesoru', () => {
    const evil = '=HYPERLINK("http://zlo.cz","klikni")';
    // Hodnota má uvozovky, takže je uzávorkovaná; apostrof zůstává první uvnitř.
    expect(escapeCsvCell(evil).startsWith('"\'=')).toBe(true);
  });

  it('null a undefined jsou prázdná buňka', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('vypíše hlavičku a řádky se středníkem', () => {
    const csv = toCsv([{ a: '1', b: '2' }], ['a', 'b']);
    expect(csv).toBe('a;b\r\n1;2\r\n');
  });

  it('chybějící sloupec je prázdná buňka, ne undefined', () => {
    expect(toCsv([{ a: '1' }], ['a', 'b'])).toBe('a;b\r\n1;\r\n');
  });

  it('prázdný vstup vypíše aspoň hlavičku', () => {
    expect(toCsv([], ['a', 'b'])).toBe('a;b\r\n');
  });
});

describe('archiv', () => {
  it('má hlavičku ZIP a v centrálním adresáři všechna jména', () => {
    const zip = createZip(
      new Map([
        ['contact.json', '{"a":1}'],
        ['README.txt', 'ahoj'],
      ]),
    );
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(zip.includes(Buffer.from('contact.json'))).toBe(true);
    expect(zip.includes(Buffer.from('README.txt'))).toBe(true);
    // Podpis konce centrálního adresáře musí být na konci, jinak archiv nikdo neotevře.
    expect(zip.subarray(-22, -18).toString('hex')).toBe('504b0506');
  });
});
