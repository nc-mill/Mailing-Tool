import { z } from '@hono/zod-openapi';

export const Uuid = z.uuid();

export const ImportResponse = z
  .object({
    id: Uuid,
    filename: z.string(),
    status: z.string(),
    encoding: z.string().nullable(),
    encoding_source: z.string().nullable(),
    delimiter: z.string().nullable(),
    has_header: z.boolean(),
    mapping: z.record(z.string(), z.unknown()),
    options: z.record(z.string(), z.unknown()),
    byte_size: z.number().int(),
    total_rows: z.number().int().nullable(),
    checkpoint_row: z.number().int(),
    /**
     * Rozpad výsledku. Bez něj nemá výsledková obrazovka odkud vzít čísla:
     * hledala je v `options` a ukazovala samé nuly i po úspěšném importu.
     * Rozlišení „nových / doplněných / přeskočených / chybných" je celý smysl
     * té obrazovky, takže patří do odpovědi, ne do dopočtu na klientovi.
     */
    created_rows: z.number().int(),
    updated_rows: z.number().int(),
    suppressed_rows: z.number().int(),
    warning_rows: z.number().int(),
    review_rows: z.number().int(),
    error_rows: z.number().int(),
    error_summary: z.record(z.string(), z.number().int()),
    failure_detail: z.string().nullable(),
  })
  .openapi('Import');

export const PatchImportRequest = z
  .object({
    mapping: z.record(z.string(), z.unknown()).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    encoding: z.string().max(32).optional(),
    delimiter: z.string().min(1).max(1).optional(),
  })
  .strict()
  .openapi('PatchImport');

/**
 * Import z JSON řádků. Strop je deset tisíc řádků a je to strop VOLAJÍCÍHO,
 * ne serveru: větší dávka patří do souboru, který se streamuje na disk.
 */
export const JsonRowsRequest = z
  .object({ rows: z.array(z.record(z.string(), z.string())).min(1) })
  .strict()
  .openapi('ImportRows');

export const PreviewRowSchema = z
  .object({
    row_number: z.number().int(),
    email: z.string().nullable(),
    title_prefix: z.string().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    gender: z.string().nullable(),
    greeting: z.string().nullable(),
    state: z.enum(['ok', 'error', 'suppressed', 'duplicate']).optional(),
    error_code: z.string().nullable().optional(),
  })
  .openapi('ImportPreviewRow');

export const ImportPreviewResponse = z
  .object({
    encoding: z.string(),
    encoding_source: z.string(),
    delimiter: z.string(),
    has_header: z.boolean(),
    header: z.array(z.string()),
    mapping: z.record(z.string(), z.unknown()),
    /**
     * Počet DATOVÝCH řádků celého souboru, bez hlavičky. Průvodce z něj skládá
     * větu „51 řádků, z toho 1 hlavička, tedy 50 kontaktů", takže hlavičku si
     * přičítá sám podle `has_header`.
     */
    total_rows: z.number().int(),
    /** U souboru nad stropem přesného průchodu je počet extrapolovaný z bajtů. */
    total_rows_approximate: z.boolean(),
    /** Prvních pár řádků v SUROVÉ podobě, ve stejném pořadí sloupců jako `header`. */
    sample_rows: z.array(z.array(z.string())),
    rows: z.array(PreviewRowSchema),
    mapping_warnings: z.array(z.string()),
  })
  .openapi('ImportPreview');

export const ImportErrorsResponse = z
  .object({
    data: z.array(
      z.object({
        row_number: z.number().int(),
        error_code: z.string(),
        column_name: z.string().nullable(),
        raw_row: z.string().nullable(),
      }),
    ),
    has_more: z.boolean(),
  })
  .openapi('ImportErrors');
