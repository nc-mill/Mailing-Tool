import { readRows } from './reader';
import { processRow } from './row-pipeline';
import type { EstimateContext } from './estimate';

export type PreviewRow = {
  rowNumber: number;
  state: 'ok' | 'error' | 'suppressed';
  /**
   * SUROVÉ buňky řádku, v pořadí sloupců souboru.
   *
   * Krok „Kontrola souboru" se ptá, jestli je text rozsypaný, a to jde poznat
   * jedině na tom, co v souboru doopravdy stojí. Skládat ukázku z výsledných
   * polí (e-mail, jméno, příjmení) dává tabulku, jejíž sloupce nesedí na
   * hlavičku, takže vypadá poškozeně i u souboru, který je v pořádku.
   */
  fields: string[];
  email: string;
  title_prefix: string | null;
  first_name: string | null;
  gender: string | null;
  last_name: string | null;
  greeting: string | null;
  attributes: Record<string, unknown>;
  errorCode?: string;
  warnings: string[];
};

export type Preview = { rows: PreviewRow[]; mappingWarnings: string[] };

/**
 * Náhled ukazuje VÝSLEDEK, ne vstup. Sloupec s oslovením je nejdůležitější
 * sloupec celé obrazovky, protože přesně to uvidí příjemce v e-mailu.
 */
export async function buildPreview(
  path: string,
  ctx: EstimateContext,
  limit = 20,
  offset = 0,
): Promise<Preview> {
  const rows: PreviewRow[] = [];
  for await (const raw of readRows(path, {
    dialect: ctx.dialect,
    encoding: ctx.encoding,
    maxCellChars: ctx.maxCellChars,
    maxLineBytes: ctx.maxLineBytes,
  })) {
    if (raw.rowNumber <= offset) continue;
    const processed = processRow(raw, ctx);
    if (processed.kind === 'error') {
      rows.push({
        rowNumber: raw.rowNumber,
        state: 'error',
        fields: raw.fields,
        email: raw.fields[0] ?? '',
        title_prefix: null,
        first_name: null,
        last_name: null,
        gender: null,
        greeting: null,
        attributes: {},
        errorCode: processed.errorCode,
        warnings: [],
      });
    } else if (processed.kind === 'suppressed') {
      rows.push({
        rowNumber: raw.rowNumber,
        state: 'suppressed',
        fields: raw.fields,
        email: raw.fields[0] ?? '',
        title_prefix: null,
        first_name: null,
        last_name: null,
        gender: null,
        greeting: null,
        attributes: {},
        warnings: ['suppressed_skipped'],
      });
    } else {
      const c = processed.contact;
      rows.push({
        rowNumber: raw.rowNumber,
        state: 'ok',
        fields: raw.fields,
        email: processed.email,
        title_prefix: c.titlePrefix ?? null,
        first_name: c.firstName ?? null,
        last_name: c.lastName ?? null,
        gender: c.gender ?? null,
        greeting: c.greeting ?? null,
        attributes: processed.attributes,
        warnings: processed.warnings,
      });
    }
    if (rows.length >= limit) break;
  }
  return { rows, mappingWarnings: [] };
}
