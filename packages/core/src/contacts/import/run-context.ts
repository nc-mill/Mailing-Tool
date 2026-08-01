import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { normalizeNameKey } from '../naming/normalize';
import type { Gender, NameOverrideLookup } from '../naming/types';
import { readContactsSettings } from '../settings';
import type { FieldSpec } from './coerce';
import { inWorkspaceTx } from './db';
import type { Dialect, Delimiter } from './dialect';
import type { DetectedEncoding, SupportedEncoding } from './encoding';
import { ImportOptionsSchema, type ImportOptions } from './options';
import type { ImportMapping } from './mapping';
import type { RowContext, RowSettings } from './row-pipeline';

export type RunContext = {
  importId: string;
  storageKey: string;
  dialect: Dialect;
  encoding: DetectedEncoding;
  options: ImportOptions;
  mapping: ImportMapping;
  fieldCatalog: Record<string, FieldSpec>;
  settings: RowSettings;
  overrides: NameOverrideLookup;
  totalRows: number | null;
  checkpointRow: number;
  checkpointByte: number;
  /** Suppression se doplňuje po dávkách, tady je jen prázdný základ. */
  rowContext: RowContext;
  isCancelled: () => Promise<boolean>;
};

type FieldRow = { key: string; type: string; required: boolean; options: { values?: string[] } };

/**
 * Přepisy jmen se načítají CELÉ, ne po jménech: import projde statisíce řádků
 * a dotaz na jméno u každého by byl statisíc round-tripů. Tabulka má strop
 * v podobě fronty ke kontrole oslovení, takže jde o jednotky tisíc řádků.
 */
function lookupFrom(
  rows: {
    kind: 'first' | 'last';
    name_key: string;
    gender: Gender | null;
    vocative: string | null;
  }[],
): NameOverrideLookup {
  const map = new Map<string, { gender?: Gender; vocative?: string }>();
  for (const row of rows) {
    map.set(`${row.kind}:${row.name_key}`, {
      ...(row.gender === null ? {} : { gender: row.gender }),
      ...(row.vocative === null ? {} : { vocative: row.vocative }),
    });
  }
  return { find: (kind, nameKey) => map.get(`${kind}:${normalizeNameKey(nameKey)}`) };
}

export async function loadRunContext(ctx: WorkspaceContext, importId: string): Promise<RunContext> {
  return inWorkspaceTx(ctx, async (tx) => {
    const { rows: imports } = await tx.execute<{
      storage_key: string | null;
      encoding: string | null;
      encoding_source: string | null;
      delimiter: string | null;
      has_header: boolean;
      mapping: ImportMapping;
      options: Record<string, unknown>;
      total_rows: number | null;
      checkpoint_row: number;
      checkpoint_byte: number;
    }>(sql`
      SELECT storage_key, encoding, encoding_source, delimiter, has_header, mapping, options,
             total_rows, checkpoint_row, checkpoint_byte
        FROM imports
       WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);
    const row = imports[0];
    if (row === undefined || row.storage_key === null) {
      throw new Error(`Import ${importId} neexistuje nebo už nemá soubor.`);
    }

    const { rows: fields } = await tx.execute<FieldRow>(sql`
      SELECT key, type, required, options FROM contact_fields
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND archived_at IS NULL`);
    const fieldCatalog: Record<string, FieldSpec> = {};
    for (const field of fields) {
      fieldCatalog[field.key] = {
        type: field.type as FieldSpec['type'],
        required: field.required,
        ...(field.options?.values === undefined ? {} : { values: field.options.values }),
      };
    }

    const { rows: overrides } = await tx.execute<{
      kind: 'first' | 'last';
      name_key: string;
      gender: Gender | null;
      vocative: string | null;
    }>(sql`
      SELECT kind, name_key, gender, vocative FROM name_overrides
       WHERE workspace_id = ${ctx.workspaceId}::uuid`);

    const contactsSettings = await readContactsSettings(tx, ctx);
    const { rows: workspaces } = await tx.execute<{
      locale: string | null;
      address_form: string | null;
    }>(sql`
      SELECT locale, address_form FROM workspaces WHERE id = ${ctx.workspaceId}::uuid`);
    const workspace = workspaces[0];

    const settings: RowSettings = {
      locale: workspace?.locale ?? 'cs',
      addressForm: workspace?.address_form === 'informal' ? 'informal' : 'formal',
      salutationBy: contactsSettings.salutation_by,
      vocativePolicy: contactsSettings.vocative_policy,
    };

    const options = ImportOptionsSchema.parse(row.options);
    const dialect: Dialect = {
      delimiter: (row.delimiter ?? ';') as Delimiter,
      quoteChar: '"',
      escape: 'double',
      hasHeader: row.has_header,
      columnCount: Object.keys(row.mapping ?? {}).length,
    };
    const encoding: DetectedEncoding = {
      encoding: (row.encoding ?? 'utf-8') as SupportedEncoding,
      source: 'manual',
      bomLength: 0,
    };

    const rowContext: RowContext = {
      mapping: row.mapping,
      options,
      fieldCatalog,
      settings,
      overrides: lookupFrom(overrides),
      suppressed: new Map<string, string>(),
    };

    return {
      importId,
      storageKey: row.storage_key,
      dialect,
      encoding,
      options,
      mapping: row.mapping,
      fieldCatalog,
      settings,
      overrides: rowContext.overrides,
      totalRows: row.total_rows === null ? null : Number(row.total_rows),
      checkpointRow: Number(row.checkpoint_row),
      checkpointByte: Number(row.checkpoint_byte),
      rowContext,
      isCancelled: async () => {
        const { rows: state } = await inWorkspaceTx(ctx, (inner) =>
          inner.execute<{ status: string }>(sql`
            SELECT status FROM imports
             WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
        );
        return state[0]?.status === 'cancelled';
      },
    };
  });
}
