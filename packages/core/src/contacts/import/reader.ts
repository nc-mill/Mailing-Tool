import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import iconv from 'iconv-lite';
import type { Dialect } from './dialect';
import type { DetectedEncoding } from './encoding';

export type RawRow = {
  /** Pořadí datového řádku od 1. Hlavička není datový řádek a nikdy se nepočítá. */
  rowNumber: number;
  fields: string[];
  raw: string;
  byteOffsetAfter: number;
  fieldCountMismatch: boolean;
  padded: boolean;
  truncatedCells: number;
};

export type ReadOptions = {
  dialect: Dialect;
  encoding: DetectedEncoding;
  maxCellChars: number;
  maxLineBytes: number;
  startByte?: number;
  startRowNumber?: number;
  onHeader?: (header: string[]) => void;
};

type ParsedRecord = { record: string[]; raw: string };

/**
 * Přeskočení na bajtový offset je bezpečné, protože obě podporovaná kódování
 * (UTF-8 i jednobajtové kódové stránky) jsou na hranici záznamu synchronizovatelná.
 * Offset ukazuje na PRVNÍ BAJT NÁSLEDUJÍCÍHO nezpracovaného záznamu.
 */
export async function* readRows(path: string, opts: ReadOptions): AsyncGenerator<RawRow> {
  const start = opts.startByte ?? 0;
  const stream = createReadStream(path, { start: start === 0 ? opts.encoding.bomLength : start });
  const decoded =
    opts.encoding.encoding === 'utf-8'
      ? stream
      : stream.pipe(iconv.decodeStream(opts.encoding.encoding)).pipe(iconv.encodeStream('utf-8'));

  const parser = decoded.pipe(
    parse({
      delimiter: opts.dialect.delimiter,
      quote: opts.dialect.quoteChar,
      escape: opts.dialect.escape === 'backslash' ? '\\' : '"',
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      info: true,
      raw: true,
      max_record_size: opts.maxLineBytes,
    }),
  );

  /*
   * `.pipe()` chybu ZDROJE cíli NEPŘEDÁVÁ. Bez tohohle řádku skončí chybějící
   * nebo nečitelný soubor tak, že parser nedostane ani data, ani konec, takže
   * `for await` níž čeká navždy. Změřeno: požadavek na náhled visel do
   * vypršení a v logu po sobě nenechal nic.
   *
   * Selhat nahlas je jediné správné chování: chybějící soubor je porucha,
   * ne prázdný soubor.
   */
  const sources: NodeJS.EventEmitter[] = stream === decoded ? [stream] : [stream, decoded];
  for (const source of sources) {
    source.on('error', (error: Error) => parser.destroy(error));
  }

  const expected = opts.dialect.columnCount;
  let rowNumber = opts.startRowNumber ?? 0;
  let headerSeen = start > 0 || !opts.dialect.hasHeader;
  let byteCursor = start === 0 ? opts.encoding.bomLength : start;

  for await (const record of parser as AsyncIterable<ParsedRecord>) {
    // Jednobajtová kódová stránka: jeden znak dekódovaného textu je právě jeden
    // bajt zdroje, takže 'binary' (latin1) vrátí délku v bajtech PŮVODNÍHO souboru.
    const bytes = Buffer.byteLength(
      record.raw,
      opts.encoding.encoding === 'utf-8' ? 'utf8' : 'binary',
    );
    byteCursor += bytes;

    if (!headerSeen) {
      headerSeen = true;
      opts.onHeader?.(record.record);
      continue;
    }

    let fields = record.record;
    let padded = false;
    let fieldCountMismatch = false;
    if (fields.length < expected) {
      // Chybí jen koncové sloupce: doplní se prázdnem a řádek dostane varování.
      fields = [...fields, ...Array.from({ length: expected - fields.length }, () => '')];
      padded = true;
    } else if (fields.length > expected) {
      fieldCountMismatch = true;
    }

    let truncatedCells = 0;
    fields = fields.map((cell) => {
      if (cell.length <= opts.maxCellChars) return cell;
      truncatedCells += 1;
      return cell.slice(0, opts.maxCellChars);
    });

    rowNumber += 1;
    yield {
      rowNumber,
      fields,
      raw: record.raw,
      byteOffsetAfter: byteCursor,
      fieldCountMismatch,
      padded,
      truncatedCells,
    };
  }
}
