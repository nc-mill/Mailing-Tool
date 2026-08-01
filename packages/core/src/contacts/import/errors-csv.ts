import { stringify } from 'csv-stringify/sync';
import iconv from 'iconv-lite';
import { guardCsvCell } from '../export/csv-injection';

export type ErrorCsvRow = {
  rowNumber: number;
  rawLine: string;
  errorCode: string;
  errorDetail: string | null;
};

export type ErrorCsvEncoding = 'utf-8' | 'windows-1250' | 'iso-8859-2';

export type ErrorCsvInput = {
  header: string[];
  rows: ErrorCsvRow[];
  encoding: ErrorCsvEncoding;
  delimiter: string;
  locale?: string;
};

export type ErrorCsvOutput = Buffer & { warnings?: string[] };

/**
 * Soubor se vrací v PŮVODNÍM kódování vstupu, ne v UTF-8: uživatel ho otevře
 * v tomtéž nástroji, ze kterého export přišel, a UTF-8 by mu v českém Excelu
 * rozsypalo diakritiku.
 *
 * Sloupce _error_code a _error_detail zůstávají anglicky vždy. Kdyby se hlavička
 * přeložila, automapování by při opětovném nahrání selhalo a smysl celé funkce
 * by zmizel.
 */
export async function buildErrorsCsv(
  input: ErrorCsvInput,
  opts: { reportLoss?: boolean } = {},
): Promise<ErrorCsvOutput> {
  const records = input.rows.map((row) => {
    const cells = row.rawLine.split(input.delimiter).map(guardCsvCell);
    while (cells.length < input.header.length) cells.push('');
    return [...cells.slice(0, input.header.length), row.errorCode, row.errorDetail ?? ''];
  });
  const text = stringify([[...input.header, '_error_code', '_error_detail'], ...records], {
    delimiter: input.delimiter,
    quoted_string: false,
    record_delimiter: '\n',
  });
  const buffer = iconv.encode(text, input.encoding) as ErrorCsvOutput;
  if (opts.reportLoss === true) {
    // Znak, který cílová kódová stránka nezná, se zakóduje jako otazník.
    // Zpětné dekódování ho proto nevrátí a rozdíl je jediný spolehlivý test.
    const roundTrip = iconv.decode(buffer, input.encoding);
    buffer.warnings = roundTrip === text ? [] : ['characters_lost'];
  }
  return buffer;
}
