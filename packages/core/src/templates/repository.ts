import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { designHash } from '@mlain/emails/document/canonical';
import type { Document } from '@mlain/emails/document/types';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

export type TemplateKind = 'campaign' | 'transactional' | 'system';

export type TemplateRow = typeof schema.templates.$inferSelect;

/** SHA-256, tedy vždy 32 bajtů. Kratší ani delší buffer se k porovnání nepustí. */
const DESIGN_HASH_BYTES = 32;

/**
 * Kurzor stránkování je DVOJICE `(updated_at, id)`, ne samotné `updated_at`.
 * Hromadná převalidace po smazání kontaktního pole posune `updated_at` mnoha
 * řádkům naráz, klidně na tutéž hodnotu, a kurzor nad jedním sloupcem by pak
 * řádky přeskakoval nebo zdvojoval. Serializuje se jako `<iso>|<uuid>`.
 */
export type ListCursor = string;

function encodeCursor(row: { updatedAt: Date; id: string }): ListCursor {
  return `${row.updatedAt.toISOString()}|${row.id}`;
}

function decodeCursor(cursor: ListCursor): { updatedAt: Date; id: string } {
  const [iso, id] = cursor.split('|');
  const updatedAt = new Date(iso ?? '');
  if (Number.isNaN(updatedAt.getTime()) || !id) throw new Error('invalid_cursor');
  return { updatedAt, id };
}

export type CreateTemplateRowInput = {
  name: string;
  kind: TemplateKind;
  design: Document;
  /**
   * POVINNÉ. Dřív se doplňovalo až druhým voláním `updateTemplateDesign`
   * s týmž dokumentem, jenže to skončilo na shodě hashe a `used_fields`
   * zůstalo prázdné napořád. Nově založená, importovaná ani duplikovaná
   * šablona se pak neobjevila v dopadové analýze smazaného pole
   * a uživatel dostal hlášku „používá to 0 šablon".
   */
  usedFields: string[];
  createdBy?: string;
  starter?: boolean;
};

export async function createTemplateRow(
  tx: Tx,
  ctx: WorkspaceContext,
  input: CreateTemplateRowInput,
): Promise<TemplateRow> {
  const [row] = await tx
    .insert(schema.templates)
    .values({
      workspaceId: ctx.workspaceId,
      name: input.name,
      kind: input.kind,
      schemaVersion: input.design.schemaVersion,
      design: input.design,
      designHash: designHash(input.design),
      usedFields: input.usedFields,
      createdBy: input.createdBy ?? null,
      starter: input.starter ?? false,
    })
    .returning();
  return row!;
}

export async function findTemplateById(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
): Promise<TemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.id, id),
        wsEq(ctx, schema.templates),
        isNull(schema.templates.deletedAt),
      ),
    );
  return row;
}

export async function listTemplates(
  tx: Tx,
  ctx: WorkspaceContext,
  options: { limit: number; cursor?: ListCursor; kind?: TemplateKind; validationState?: string },
): Promise<{ items: TemplateRow[]; nextCursor: ListCursor | null }> {
  const conditions = [wsEq(ctx, schema.templates), isNull(schema.templates.deletedAt)];
  if (options.cursor) {
    const after = decodeCursor(options.cursor);
    // Řazení je (updated_at DESC, id DESC), takže „za kurzorem" znamená
    // buď starší updated_at, nebo shodné updated_at a menší id.
    conditions.push(
      or(
        lt(schema.templates.updatedAt, after.updatedAt),
        and(eq(schema.templates.updatedAt, after.updatedAt), lt(schema.templates.id, after.id)),
      )!,
    );
  }
  if (options.kind) conditions.push(eq(schema.templates.kind, options.kind));
  if (options.validationState) {
    conditions.push(
      eq(
        schema.templates.validationState,
        options.validationState as TemplateRow['validationState'],
      ),
    );
  }
  const items = await tx
    .select()
    .from(schema.templates)
    .where(and(...conditions))
    .orderBy(desc(schema.templates.updatedAt), desc(schema.templates.id))
    .limit(options.limit + 1);
  const page = items.slice(0, options.limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: items.length > options.limit && last ? encodeCursor(last) : null,
  };
}

/**
 * Zápis pracovní verze. Když se hash nezměnil, nezapisuje se nic:
 * autosave běží každých pět sekund a bez tohohle by přepisoval řádek pořád dokola.
 */
export async function updateTemplateDesign(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  design: Document,
  usedFields: string[],
  expectedHash?: Buffer,
): Promise<{ changed: boolean; row: TemplateRow }> {
  // Délku kontrolujeme dřív, než se buffer dostane k porovnání. Hodnota chodí
  // z hlavičky requestu, takže sem může přijít prázdný i přerostlý buffer
  // a `.equals()` by na něm jen tiše vrátil false, tedy „konflikt".
  if (expectedHash && expectedHash.length !== DESIGN_HASH_BYTES) {
    throw new Error('precondition_malformed');
  }
  const current = await findTemplateById(tx, ctx, id);
  if (!current) throw new Error('not_found');
  if (expectedHash && !current.designHash.equals(expectedHash)) {
    throw new Error('precondition_failed');
  }
  const hash = designHash(design);
  if (current.designHash.equals(hash)) return { changed: false, row: current };
  const [row] = await tx
    .update(schema.templates)
    .set({
      design,
      designHash: hash,
      schemaVersion: design.schemaVersion,
      usedFields,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.templates.id, id), wsEq(ctx, schema.templates)))
    .returning();
  return { changed: true, row: row! };
}

export async function setValidationState(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  state: 'unknown' | 'valid' | 'invalid',
  errors: unknown[],
): Promise<void> {
  await tx
    .update(schema.templates)
    .set({ validationState: state, validationErrors: errors, updatedAt: new Date() })
    .where(and(eq(schema.templates.id, id), wsEq(ctx, schema.templates)));
}

export async function softDeleteTemplate(tx: Tx, ctx: WorkspaceContext, id: string): Promise<void> {
  await tx
    .update(schema.templates)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.templates.id, id), wsEq(ctx, schema.templates)));
}

export async function findTemplateIdsUsingField(
  tx: Tx,
  ctx: WorkspaceContext,
  path: string,
): Promise<Array<{ id: string; name: string }>> {
  // GIN index nad used_fields; bez něj by to byl sekvenční průchod s deserializací JSON.
  return tx
    .select({ id: schema.templates.id, name: schema.templates.name })
    .from(schema.templates)
    .where(
      and(
        wsEq(ctx, schema.templates),
        isNull(schema.templates.deletedAt),
        sql`${schema.templates.usedFields} @> ARRAY[${path}]::text[]`,
      ),
    )
    .orderBy(asc(schema.templates.name));
}
