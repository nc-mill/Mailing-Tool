import { sql, type SQL } from 'drizzle-orm';
import { upsertContacts } from '../repo/contacts';
import type { UpsertMode } from '../types';
import type { WorkspaceContext } from '../../identity/types';
import { inWorkspaceTx } from './db';
import type { ProcessedOkRow } from './row-pipeline';

export type ErrRow = {
  rowNumber: number;
  errorCode: string;
  severity: 'error' | 'warning';
  column?: string | undefined;
  detail?: string | undefined;
  raw: string;
};

export type BatchInput = {
  importId: string;
  mode: UpsertMode;
  rows: ProcessedOkRow[];
  /** Chybné i varovné řádky v jednom seznamu, rozlišené polem severity. */
  errors: ErrRow[];
  checkpointRow: number;
  checkpointByte: number;
  suppressedCount: number;
  maxStoredErrors: number;
};

export type BatchResult = { created: number; updated: number };

/**
 * Zápis kontaktů, chybných řádků I CHECKPOINTU v JEDNÉ transakci. Tohle je jádro
 * obnovitelnosti: pád workera kdykoliv uprostřed znamená rollback celé dávky
 * a po restartu se čte od `checkpoint_row + 1`, ne od začátku a ne podruhé.
 *
 * Zápis `updated_at` v checkpointu není kosmetika: je to jediný signál živosti
 * importu a stojí na něm obnova po pádu. Bez něj by zabitý worker nechal import
 * navždy ve stavu `importing` a `singletonKey` by projektu zablokoval i všechny
 * další importy.
 */
export async function writeBatch(ctx: WorkspaceContext, input: BatchInput): Promise<BatchResult> {
  return inWorkspaceTx(ctx, async (tx) => {
    let created = 0;
    let updated = 0;

    // 1. Kontakty. Zápis NEDĚLÁ tenhle plán, dělá ho upsertContacts z P07.
    //    Je to jediné místo v produktu, kde kontakt hromadně vzniká, a jde přes
    //    něj všechny čtyři kanály (API, formulář, webhook, import). Vlastní INSERT
    //    by znamenal druhou implementaci upsertu, která se s tou první rozejde,
    //    a hlavně by zapomněl na sloupce, o kterých import neví: bez
    //    `first_name_key` a `last_name_key` by fronta ke kontrole oslovení
    //    zůstala po importu prázdná, protože stojí právě na těch klíčích.
    if (input.rows.length > 0) {
      const written = await upsertContacts(
        ctx,
        {
          mode: input.mode,
          rows: input.rows.map((r) => ({
            ...r.contact,
            attributes: r.attributes,
            source: 'import',
            sourceRef: input.importId,
          })),
        },
        tx,
      );
      created = written.filter((r) => r.inserted).length;
      updated = written.length - created;
    }

    // 2. Chybné a varovné řádky. Nad limit se jen inkrementují čítače.
    //    severity se bere z řádku, NENÍ natvrdo 'error': varovné řádky se počítají
    //    do warning_rows i do error_summary, takže kdyby se ukládaly jako 'error',
    //    uživatel by u varování viděl počet, ale nedohledal by ani jeden řádek,
    //    který ho způsobil, a stažení chybných řádků by mu vrátilo i varování.
    const stored = input.errors.slice(0, Math.max(0, input.maxStoredErrors));
    if (stored.length > 0) {
      await tx.execute(sql`
        INSERT INTO import_errors (id, import_id, workspace_id, row_number, severity,
                                   column_name, error_code, error_detail, raw_line)
        SELECT uuidv7(), ${input.importId}::uuid, ${ctx.workspaceId}::uuid,
               u.row_number, u.severity, u.column_name, u.error_code, u.error_detail, u.raw_line
          FROM unnest(
            ${sql.param(stored.map((e) => e.rowNumber))}::bigint[],
            ${sql.param(stored.map((e) => e.severity))}::text[],
            ${sql.param(stored.map((e) => e.column ?? null))}::text[],
            ${sql.param(stored.map((e) => e.errorCode))}::text[],
            ${sql.param(stored.map((e) => e.detail ?? null))}::text[],
            ${sql.param(stored.map((e) => e.raw))}::text[]
          ) AS u(row_number, severity, column_name, error_code, error_detail, raw_line)`);
    }

    const errorRows = input.errors.filter((e) => e.severity === 'error').length;
    const warningRows = input.errors.length - errorRows;

    const summary: Record<string, number> = {};
    for (const e of input.errors) summary[e.errorCode] = (summary[e.errorCode] ?? 0) + 1;

    // 3. Checkpoint. Ve STEJNÉ transakci jako body 1 a 2.
    await tx.execute(sql`
      UPDATE imports SET
        checkpoint_row = ${input.checkpointRow},
        checkpoint_byte = ${input.checkpointByte},
        processed_rows  = processed_rows + ${input.rows.length + input.errors.length},
        created_rows    = created_rows + ${created},
        updated_rows    = updated_rows + ${updated},
        error_rows      = error_rows + ${errorRows},
        warning_rows    = warning_rows + ${warningRows},
        suppressed_rows = suppressed_rows + ${input.suppressedCount},
        stored_error_count = stored_error_count + ${stored.length},
        error_summary   = ${mergeSummarySql(summary)},
        updated_at      = now()
      WHERE id = ${input.importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);

    return { created, updated };
  });
}

/**
 * Sečte dosavadní error_summary s přírůstkem téhle dávky.
 *
 * Operátor `||` nad jsonb klíče na první úrovni NAHRAZUJE, nesčítá:
 * `'{"email_invalid":3}' || '{"email_invalid":5}'` je `5`, ne `8`. U importu
 * s víc než jednou dávkou by tedy `error_summary` na konci obsahovala počty
 * z POSLEDNÍ dávky, ne za celý soubor, a výsledková obrazovka by u souboru
 * s deseti tisíci chybami klidně napsala „3 neplatné adresy". Test na jednu
 * dávku to nikdy neodhalí, protože při jedné dávce je nahrazení a součet totéž.
 */
function mergeSummarySql(increment: Record<string, number>): SQL {
  return sql`(
    SELECT coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}'::jsonb)
      FROM (SELECT key AS k, sum(value::bigint) AS v
              FROM (SELECT key, value FROM jsonb_each_text(imports.error_summary)
                    UNION ALL
                    SELECT key, value FROM jsonb_each_text(${JSON.stringify(increment)}::jsonb)) merged
             GROUP BY key) summed)`;
}
