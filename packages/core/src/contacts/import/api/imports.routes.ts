import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../errors/api-error';
import { assertPermission } from '../../../identity/permissions';
import { IdempotencyHeaderSchema, problemResponse } from '../../../identity/api/schemas';
import type { WorkspaceContext } from '../../../identity/types';
import { inWorkspaceTx } from '../db';
import { buildErrorsCsv, type ErrorCsvEncoding } from '../errors-csv';
import { estimateFile, type EstimateContext } from '../estimate';
import { importLimits } from '../limits';
import { buildPreview } from '../preview';
import { loadRunContext } from '../run-context';
import {
  cancelImport,
  confirmImport,
  createImport,
  detectAndPreview,
  loadImport,
  patchImport,
  readHeaderRow,
  resumeImport,
  setTotalRows,
  type ImportRow,
} from '../service';
import type { ImportsEnv } from './index';
import {
  ImportErrorsResponse,
  ImportPreviewResponse,
  ImportResponse,
  JsonRowsRequest,
  PatchImportRequest,
  Uuid,
} from './schemas';

const TAG = 'Imports';

const IdParam = z.object({ id: Uuid });

/** Strop pro variantu s JSON řádky. Větší dávka patří do souboru, ne do těla. */
const MAX_JSON_ROWS = 10_000;

function present(row: ImportRow): z.infer<typeof ImportResponse> {
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    encoding: row.encoding,
    encoding_source: row.encoding_source,
    delimiter: row.delimiter,
    has_header: row.has_header,
    mapping: (row.mapping ?? {}) as Record<string, unknown>,
    options: row.options ?? {},
    byte_size: Number(row.byte_size),
    total_rows: row.total_rows === null ? null : Number(row.total_rows),
    checkpoint_row: Number(row.checkpoint_row),
    // `Number()` tu není zdvořilost: počty jsou v Postgresu `bigint` a ovladač
    // je vrací jako řetězec, takže bez převodu by ve výsledku byly „50" místo 50
    // a schéma `z.number().int()` by odpověď odmítlo.
    created_rows: Number(row.created_rows),
    updated_rows: Number(row.updated_rows),
    suppressed_rows: Number(row.suppressed_rows),
    warning_rows: Number(row.warning_rows),
    review_rows: Number(row.review_rows),
    error_rows: Number(row.error_rows),
    error_summary: row.error_summary ?? {},
    failure_detail: row.failure_detail,
  };
}

/**
 * Tělo požadavku jako proud.
 *
 * Preferovaný tvar je SUROVÉ tělo se jménem souboru v hlavičce `X-Filename`:
 * `c.req.raw.body` je `ReadableStream`, který jde předat rovnou zápisu na disk,
 * takže server nikdy nedrží 200 MB v paměti (rozhodnutí R4). Klient tím
 * nepřichází o nic: `XMLHttpRequest.send(file)` hlásí `upload.onprogress`
 * i `abort()` stejně jako u FormData.
 *
 * ODCHYLKA OD PLÁNU: plán počítal s `multipart/form-data` a pomocníkem
 * `multipartFileStream()`. Proudový parser multipartu v závislostech není
 * a přidávat ho by znamenalo novou závislost mimo tři schválené, takže
 * multipart zůstává jako záložní cesta a JE bufferovaný. Pro velké soubory
 * se používá surové tělo.
 */
async function bodyStream(
  request: Request,
): Promise<{ stream: Readable; filename: string; buffered: boolean }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ApiError('validation_failed', {
        errors: [{ path: 'file', code: 'required_field_missing', message: 'Chybí soubor.' }],
      });
    }
    return {
      stream: Readable.from(Buffer.from(await file.arrayBuffer())),
      filename: file.name,
      buffered: true,
    };
  }
  const body = request.body;
  if (body === null) {
    throw new ApiError('validation_failed', {
      errors: [{ path: 'file', code: 'required_field_missing', message: 'Chybí soubor.' }],
    });
  }
  const filename = request.headers.get('x-filename') ?? 'import.csv';
  return { stream: Readable.fromWeb(body as never), filename, buffered: false };
}

function rowsToCsvStream(rows: Record<string, string>[]): Readable {
  const header = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = [
    header.join(','),
    ...rows.map((row) => header.map((key) => escape(row[key] ?? '')).join(',')),
  ];
  return Readable.from([`${lines.join('\n')}\n`]);
}

function requireIdempotencyKey(header: string | undefined): void {
  if (header === undefined || header.trim() === '') {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'Idempotency-Key',
          code: 'required_field_missing',
          message: 'Nahrání souboru vyžaduje hlavičku Idempotency-Key.',
        },
      ],
    });
  }
}

const createImportRoute = createRoute({
  method: 'post',
  path: '/contacts/imports',
  tags: [TAG],
  summary: 'Nahrání souboru s kontakty',
  security: [{ bearerAuth: ['contacts:import'] }],
  request: { headers: IdempotencyHeaderSchema },
  responses: {
    /*
     * 202, ne 201: vrácený import je ve stavu pending a projde ještě
     * validating a previewing, než vůbec něco naimportuje. 201 Created
     * slibuje zdroj v koncovém stavu, což tady neplatí.
     */
    202: {
      description: 'Přijato ke zpracování',
      content: { 'application/json': { schema: ImportResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('conflict'),
    413: problemResponse('payload_too_large'),
    422: problemResponse('validation_failed'),
  },
});

const listImportsRoute = createRoute({
  method: 'get',
  path: '/contacts/imports',
  tags: [TAG],
  summary: 'Importy projektu',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) },
  responses: {
    200: {
      description: 'Importy',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(ImportResponse), has_more: z.boolean() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const getImportRoute = createRoute({
  method: 'get',
  path: '/contacts/imports/{id}',
  tags: [TAG],
  summary: 'Jeden import',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Import', content: { 'application/json': { schema: ImportResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const previewRoute = createRoute({
  method: 'get',
  path: '/contacts/imports/{id}/preview',
  tags: [TAG],
  summary: 'Náhled prvních řádků včetně oslovení',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: {
    params: IdParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: {
    200: {
      description: 'Náhled',
      content: { 'application/json': { schema: ImportPreviewResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
  },
});

const patchImportRoute = createRoute({
  method: 'patch',
  path: '/contacts/imports/{id}',
  tags: [TAG],
  summary: 'Úprava mapování, kódování a voleb',
  security: [{ bearerAuth: ['contacts:import'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchImportRequest } } },
  },
  responses: {
    200: {
      description: 'Upravený import',
      content: { 'application/json': { schema: ImportResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const confirmRoute = createRoute({
  method: 'post',
  path: '/contacts/imports/{id}/confirm',
  tags: [TAG],
  summary: 'Spuštění importu',
  security: [{ bearerAuth: ['contacts:import'] }],
  request: { params: IdParam },
  responses: {
    202: { description: 'Zařazeno', content: { 'application/json': { schema: ImportResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    423: problemResponse('locked'),
  },
});

const cancelRoute = createRoute({
  method: 'post',
  path: '/contacts/imports/{id}/cancel',
  tags: [TAG],
  summary: 'Zrušení běžícího importu',
  security: [{ bearerAuth: ['contacts:import'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Zrušeno',
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('cancelled'), failure_detail: z.string() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
  },
});

const resumeRoute = createRoute({
  method: 'post',
  path: '/contacts/imports/{id}/resume',
  tags: [TAG],
  summary: 'Pokračování zrušeného importu od checkpointu',
  security: [{ bearerAuth: ['contacts:import'] }],
  request: { params: IdParam },
  responses: {
    202: {
      description: 'Nový import navázaný na předchozí',
      content: {
        'application/json': {
          schema: z.object({
            id: Uuid,
            checkpoint_byte: z.number().int(),
            resume_from_import_id: Uuid,
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
  },
});

const errorsRoute = createRoute({
  method: 'get',
  path: '/contacts/imports/{id}/errors',
  tags: [TAG],
  summary: 'Chybné řádky importu',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: {
    params: IdParam,
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
  },
  responses: {
    200: {
      description: 'Chybné řádky',
      content: { 'application/json': { schema: ImportErrorsResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const errorsCsvRoute = createRoute({
  method: 'get',
  path: '/contacts/imports/{id}/errors.csv',
  tags: [TAG],
  summary: 'Chybné řádky ke stažení v původním kódování',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Chybné řádky ke stažení' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

type ErrorRowDb = {
  row_number: number;
  error_code: string;
  column_name: string | null;
  raw_row: string | null;
  error_detail: string | null;
};

async function loadErrorRows(
  ctx: WorkspaceContext,
  importId: string,
  limit: number,
): Promise<ErrorRowDb[]> {
  const { rows } = await inWorkspaceTx(ctx, (tx) =>
    tx.execute<ErrorRowDb>(sql`
      SELECT row_number, error_code, column_name, raw_row, error_detail
        FROM import_errors
       WHERE import_id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
       ORDER BY row_number ASC LIMIT ${limit}`),
  );
  return rows;
}

export function registerImportRoutes(app: OpenAPIHono<ImportsEnv>): void {
  app.openapi(createImportRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:import');
    requireIdempotencyKey(c.req.header('idempotency-key'));

    const contentType = c.req.header('content-type') ?? '';
    let created: { id: string; status: string };
    if (contentType.includes('application/json')) {
      const body = JsonRowsRequest.parse(await c.req.json());
      if (body.rows.length > MAX_JSON_ROWS) {
        throw new ApiError('payload_too_large', {
          errors: [
            { path: 'rows', code: 'too_many_rows', message: `Nejvýš ${MAX_JSON_ROWS} řádků.` },
          ],
        });
      }
      created = await createImport(ctx, {
        stream: rowsToCsvStream(body.rows),
        filename: 'api.csv',
      });
    } else {
      const { stream, filename } = await bodyStream(c.req.raw);
      created = await createImport(ctx, { stream, filename });
    }
    c.header('Location', `/api/v1/contacts/imports/${created.id}`);
    return c.json(present(await loadImport(ctx, created.id)), 202);
  });

  app.openapi(listImportsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const { limit } = c.req.valid('query');
    const { rows } = await inWorkspaceTx(ctx, (tx) =>
      tx.execute<ImportRow>(sql`
        SELECT * FROM imports WHERE workspace_id = ${ctx.workspaceId}::uuid
         ORDER BY created_at DESC LIMIT ${limit + 1}`),
    );
    return c.json({ data: rows.slice(0, limit).map(present), has_more: rows.length > limit }, 200);
  });

  app.openapi(getImportRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    return c.json(present(await loadImport(ctx, c.req.valid('param').id)), 200);
  });

  app.openapi(previewRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const { id } = c.req.valid('param');
    const { limit, offset } = c.req.valid('query');
    let row = await loadImport(ctx, id);
    // Detekce běží jen jednou, na přechodu pending → previewing. Podruhé už
    // by přepsala ruční volbu kódování, kterou uživatel udělal v kroku 2.
    if (row.status === 'pending' || row.status === 'validating') {
      await detectAndPreview(ctx, id);
      row = await loadImport(ctx, id);
    }
    // Do lokální proměnné, ne přímo z `row`: `row` se výš přiřazuje uvnitř
    // podmínky, takže TypeScript zúžení typu po téhle kontrole neudrží
    // a `storage_key` zůstane `string | null`.
    const storageKey = row.storage_key;
    if (storageKey === null) throw new ApiError('not_found');

    /*
     * Kontext se SKLÁDÁ Z `loadRunContext()`, neplní se ručně, a je to oprava
     * konkrétní vady, ne úklid.
     *
     * Dřív tu stál objekt s poli `encoding: 'utf-8'`, `delimiter`, `hasHeader`
     * a `limits`, přetypovaný `as never`. Jenže `buildPreview` čte `ctx.dialect`,
     * `ctx.encoding.encoding`, `ctx.maxCellChars` a `ctx.maxLineBytes`, tedy
     * ani jedno z toho. Přetypování tu neshodu utlumilo a náhled padal na
     *
     *   Error: Encoding not recognized: 'undefined' (searched as: 'undefined')
     *
     * tedy pětistovkou při KAŽDÉM volání. Průvodce chybu tiše přeskakoval,
     * takže obrazovka místo počtu kontaktů ukazovala výchozí nulu a středník,
     * přestože server měl v databázi správně detekovanou čárku. Uživatel pak
     * ručně přepisoval nastavení, které bylo v pořádku.
     *
     * `loadRunContext()` skládá tentýž kontext, se kterým import doopravdy
     * poběží, takže náhled ukazuje výsledek běhu, ne jinak nastavený odhad.
     * `existingEmails` je prázdná množina schválně: rozdíl „nový versus
     * aktualizovaný" náhled netvrdí a načítat kvůli němu všechny e-maily
     * projektu by byl neúměrný dotaz.
     */
    const limits = importLimits();
    const run = await loadRunContext(ctx, id);
    const previewCtx: EstimateContext = {
      ...run.rowContext,
      dialect: run.dialect,
      encoding: run.encoding,
      maxCellChars: limits.maxCellChars,
      maxLineBytes: limits.maxLineBytes,
      existingEmails: new Set<string>(),
      byteSize: Number(row.byte_size),
    };
    /*
     * CESTA SE SKLÁDÁ Z `dataDir`, nepředává se holý `storage_key`.
     *
     * `storage_key` je relativní klíč (`imports/<projekt>/<id>.csv`), kdežto
     * `readRows()` otevírá soubor přímo, takže dřív četl neexistující cestu.
     * Neprojevilo se to chybou: `stream.pipe()` chybu zdroje nepředá cíli,
     * takže parser jen nikdy nedostal ani data, ani konec, a požadavek visel
     * až do vypršení. Tentýž tvar má `run-import.ts` na řádku s `join()`.
     */
    const path = join(limits.dataDir, storageKey);
    const preview = await buildPreview(path, previewCtx, limit, offset);
    const header = await readHeaderRow(row);

    /*
     * Počet řádků je číslo o CELÉM souboru, ne o dvaceti řádcích náhledu.
     * Krok „Kontrola souboru" se ptá „tedy 50 kontaktů?" a odpověď musí sedět,
     * jinak uživatel usoudí, že se nahrála jen část souboru.
     *
     * Počítá se jednou a ukládá do `imports.total_rows`; `patchImport()` ho
     * zahazuje, kdykoli se změní kódování nebo oddělovač. Bez toho by se
     * dvousetmegabajtový soubor přečetl znovu při každém kroku průvodce.
     */
    let totalRows = row.total_rows === null ? null : Number(row.total_rows);
    let approximate = false;
    if (totalRows === null) {
      const estimate = await estimateFile(path, previewCtx);
      totalRows = estimate.totalRows;
      approximate = estimate.approximate;
      await setTotalRows(ctx, id, totalRows);
    }

    return c.json(
      {
        encoding: row.encoding ?? 'utf-8',
        encoding_source: row.encoding_source ?? 'detected',
        delimiter: row.delimiter ?? ';',
        has_header: row.has_header,
        header,
        mapping: (row.mapping ?? {}) as Record<string, unknown>,
        total_rows: totalRows,
        total_rows_approximate: approximate,
        sample_rows: preview.rows.slice(0, 3).map((r) => r.fields),
        rows: preview.rows.map((r) => ({
          row_number: r.rowNumber,
          email: r.email,
          title_prefix: r.title_prefix,
          first_name: r.first_name,
          last_name: r.last_name,
          gender: r.gender,
          greeting: r.greeting,
          state: r.state,
          error_code: r.errorCode ?? null,
        })),
        mapping_warnings: preview.mappingWarnings,
      },
      200,
    );
  });

  app.openapi(patchImportRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:import');
    const body = c.req.valid('json');
    const row = await patchImport(ctx, c.req.valid('param').id, body as never);
    return c.json(present(row), 200);
  });

  app.openapi(confirmRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:import');
    return c.json(present(await confirmImport(ctx, c.req.valid('param').id)), 202);
  });

  app.openapi(cancelRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:import');
    const out = await cancelImport(ctx, c.req.valid('param').id);
    return c.json({ status: out.status, failure_detail: out.failureDetail }, 200);
  });

  app.openapi(resumeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:import');
    const out = await resumeImport(ctx, c.req.valid('param').id);
    return c.json(
      {
        id: out.id,
        checkpoint_byte: out.checkpointByte,
        resume_from_import_id: out.resumeFromImportId,
      },
      202,
    );
  });

  app.openapi(errorsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const { limit } = c.req.valid('query');
    const rows = await loadErrorRows(ctx, c.req.valid('param').id, limit + 1);
    return c.json(
      {
        data: rows.slice(0, limit).map((r) => ({
          row_number: Number(r.row_number),
          error_code: r.error_code,
          column_name: r.column_name,
          raw_row: r.raw_row,
        })),
        has_more: rows.length > limit,
      },
      200,
    );
  });

  app.openapi(errorsCsvRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const id = c.req.valid('param').id;
    const row = await loadImport(ctx, id);
    const rows = await loadErrorRows(ctx, id, 50_000);
    const encoding = (row.encoding ?? 'utf-8') as ErrorCsvEncoding;
    const delimiter = row.delimiter ?? ';';
    const header = (rows[0]?.raw_row ?? '').split(delimiter).map((_, i) => `col_${i + 1}`);
    const buffer = await buildErrorsCsv({
      header,
      rows: rows.map((r) => ({
        rowNumber: Number(r.row_number),
        rawLine: r.raw_row ?? '',
        errorCode: r.error_code,
        errorDetail: r.error_detail,
      })),
      encoding,
      delimiter,
    });
    const base = row.filename.replace(/\.[^.]+$/, '');
    c.header('content-type', `text/csv; charset=${encoding}`);
    c.header('content-disposition', `attachment; filename="${base}-errors.csv"`);
    return c.body(new Uint8Array(buffer));
  });
}
