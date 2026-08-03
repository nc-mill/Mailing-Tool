import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../../errors/api-error';
import { assertPermission } from '../../../identity/permissions';
import { problemResponse } from '../../../identity/api/schemas';
import { createExport, loadExport, verifyDownloadToken } from '../service';
import { createFileExportStorage } from '../storage';
import type { ExportsEnv } from './index';
import { CreateExportRequest, ExportResponse, Uuid } from './schemas';

const TAG = 'Exports';

const IdParam = z.object({ id: Uuid });

const createExportRoute = createRoute({
  method: 'post',
  path: '/contacts/exports',
  tags: [TAG],
  summary: 'Založení exportu kontaktů',
  security: [{ bearerAuth: ['contacts:export'] }],
  request: { body: { content: { 'application/json': { schema: CreateExportRequest } } } },
  responses: {
    202: {
      description: 'Export zařazen',
      content: { 'application/json': { schema: ExportResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const getExportRoute = createRoute({
  method: 'get',
  path: '/contacts/exports/{id}',
  tags: [TAG],
  summary: 'Stav exportu',
  security: [{ bearerAuth: ['contacts:export'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Export', content: { 'application/json': { schema: ExportResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const downloadRoute = createRoute({
  method: 'get',
  path: '/contacts/exports/{id}/download',
  tags: [TAG],
  summary: 'Stažení hotového exportu jednorázovým tokenem',
  security: [{ bearerAuth: ['contacts:export'] }],
  request: { params: IdParam, query: z.object({ token: z.string().min(10).max(200) }) },
  responses: {
    200: { description: 'Soubor' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

export function registerExportRoutes(app: OpenAPIHono<ExportsEnv>): void {
  app.openapi(createExportRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:export');
    const body = c.req.valid('json');
    const created = await createExport(ctx, {
      kind: body.kind,
      filter: body.filter,
      columns: body.columns,
      ...(body.format === undefined ? {} : { format: body.format }),
      ...(body.encoding === undefined ? {} : { encoding: body.encoding }),
      ...(body.delimiter === undefined ? {} : { delimiter: body.delimiter }),
      ...(body.locale === undefined ? {} : { locale: body.locale }),
    });
    const row = await loadExport(ctx, created.id);
    return c.json(
      {
        id: created.id,
        kind: row.kind,
        format: row.format,
        encoding: created.encoding,
        delimiter: created.delimiter,
        status: row.status,
        // Token je v odpovědi PRÁVĚ JEDNOU. Uložený je jen jeho hash, takže
        // druhé zavolání GET /exports/{id} ho už nevrátí a vrátit nemůže.
        download_url: `/api/v1/contacts/exports/${created.id}/download?token=${created.downloadToken}`,
      },
      202,
    );
  });

  app.openapi(getExportRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:export');
    const row = await loadExport(ctx, c.req.valid('param').id);
    return c.json(
      {
        id: row.id,
        kind: row.kind,
        format: row.format,
        encoding: row.encoding,
        delimiter: row.delimiter,
        status: row.status,
        download_url: null,
      },
      200,
    );
  });

  app.openapi(downloadRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:export');
    const id = c.req.valid('param').id;
    const { token } = c.req.valid('query');
    // Vadný token vrací 404, ne 403. 403 by prozradilo, že export existuje.
    const ok = await verifyDownloadToken(ctx, id, token);
    if (!ok) throw new ApiError('not_found');
    const row = await loadExport(ctx, id);
    if (row.storage_key === null) throw new ApiError('not_found');
    // `storage_key` je cesta RELATIVNÍ k DATA_DIR (tak ji zapisuje job), ne absolutní.
    // Bez tohohle spojení se soubor hledal vůči pracovnímu adresáři procesu, takže
    // stažení skončilo ENOENT u každého hotového exportu.
    const path = createFileExportStorage().resolve(row.storage_key);
    // Archiv subjektu údajů je ZIP, ne CSV. Sloupec `format` to říct neumí, protože
    // `ck_exports__format` pouští jen `csv` a `ndjson`; druh exportu ano.
    const zipped = row.kind === 'gdpr_subject';
    const contentType = zipped
      ? 'application/zip'
      : row.format === 'ndjson'
        ? 'application/x-ndjson'
        : 'text/csv';
    c.header('content-type', zipped ? contentType : `${contentType}; charset=${row.encoding}`);
    const extension = zipped ? 'zip' : row.format;
    c.header('content-disposition', `attachment; filename="${row.kind}-${id}.${extension}"`);
    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
  });
}
