import { invalidImport } from './errors';

export type Delimiter = ';' | ',' | '\t' | '|';
export type Dialect = {
  delimiter: Delimiter;
  quoteChar: '"';
  escape: 'double' | 'backslash';
  hasHeader: boolean;
  columnCount: number;
};

/** Pořadí je priorita rozstřelu: středník první, protože český Excel. */
const CANDIDATES: Delimiter[] = [';', ',', '\t', '|'];

function splitRespectingQuotes(line: string, delimiter: string): number {
  let fields = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      fields += 1;
    }
  }
  return fields;
}

function modeOf(counts: number[]): { mode: number; hits: number } {
  const tally = new Map<number, number>();
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
  let mode = 0;
  let hits = 0;
  for (const [value, count] of tally) {
    if (count > hits || (count === hits && value > mode)) {
      mode = value;
      hits = count;
    }
  }
  return { mode, hits };
}

export function detectDialect(sample: string): Dialect {
  const lines = sample
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 20);
  const first = lines[0];
  if (first === undefined) {
    invalidImport('_', 'empty_file', 'Sample has no non empty line.');
  }

  let best: { delimiter: Delimiter; mode: number; hits: number } | null = null;
  for (const delimiter of CANDIDATES) {
    const { mode, hits } = modeOf(lines.map((line) => splitRespectingQuotes(line, delimiter)));
    if (mode < 2) continue;
    if (best === null || hits > best.hits || (hits === best.hits && mode > best.mode)) {
      best = { delimiter, mode, hits };
    }
  }
  if (best === null) {
    invalidImport('_', 'delimiter_not_detected', 'No delimiter splits the sample into columns.');
  }

  const escape: Dialect['escape'] =
    sample.includes('\\"') && !sample.includes('""') ? 'backslash' : 'double';

  // Hlavička se předpokládá, když je každá buňka neprázdná, není čistě číselná
  // a všechny jsou jedinečné. Jinak se sloupce pojmenují Sloupec 1, Sloupec 2.
  const firstCells = first.split(best.delimiter).map((c) => c.replace(/^"|"$/g, '').trim());
  const hasHeader =
    firstCells.length === best.mode &&
    firstCells.every((c) => c.length > 0 && !/^-?\d+([.,]\d+)?$/.test(c)) &&
    new Set(firstCells.map((c) => c.toLowerCase())).size === firstCells.length;

  return { delimiter: best.delimiter, quoteChar: '"', escape, hasHeader, columnCount: best.mode };
}
