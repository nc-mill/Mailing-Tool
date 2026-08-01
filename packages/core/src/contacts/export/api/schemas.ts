import { z } from '@hono/zod-openapi';

export const Uuid = z.uuid();

export const CreateExportRequest = z
  .object({
    kind: z.enum(['contacts', 'import_errors', 'suppressions', 'gdpr_subject']).default('contacts'),
    filter: z.record(z.string(), z.unknown()).default({}),
    columns: z.array(z.string().min(1).max(120)).min(1),
    format: z.enum(['csv', 'ndjson']).optional(),
    encoding: z.enum(['utf-8-bom', 'utf-8', 'windows-1250']).optional(),
    delimiter: z.string().min(1).max(1).optional(),
    locale: z.string().max(35).optional(),
  })
  .strict()
  .openapi('CreateExport');

export const ExportResponse = z
  .object({
    id: Uuid,
    kind: z.string(),
    format: z.enum(['csv', 'ndjson']),
    encoding: z.string(),
    delimiter: z.string(),
    status: z.string(),
    download_url: z.string().nullable(),
  })
  .openapi('Export');
