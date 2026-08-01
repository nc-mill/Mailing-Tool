import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { pgErrorCode, withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import {
  CONTACT_FIELD_LIMIT,
  CONTACT_INDEXED_FIELD_LIMIT,
  assertFieldKeyAllowed,
} from '../fields/limits';
import { isDeletionBlocked, type FieldImpact } from '../fields/impact';
import { enqueue } from '../jobs/enqueue';

export type ContactFieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'multi_enum'
  | 'url'
  | 'email'
  | 'phone';

export type ContactField = {
  id: string;
  key: string;
  type: ContactFieldType;
  label: Record<string, string>;
  description: Record<string, string>;
  options: Record<string, unknown>;
  required: boolean;
  subjectEditable: boolean;
  indexed: boolean;
  indexState: 'none' | 'building' | 'ready' | 'failed';
  position: number;
  archivedAt: Date | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type CreateFieldInput = {
  key: string;
  type: ContactFieldType;
  label: Record<string, string> & { en: string };
  description?: Record<string, string>;
  options?: Record<string, unknown>;
  required?: boolean;
  subjectEditable?: boolean;
};

type FieldRow = {
  id: string;
  key: string;
  type: ContactFieldType;
  label: Record<string, string>;
  description: Record<string, string>;
  options: Record<string, unknown>;
  required: boolean;
  subject_editable: boolean;
  indexed: boolean;
  index_state: 'none' | 'building' | 'ready' | 'failed';
  position: number;
  archived_at: Date | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function toField(row: FieldRow): ContactField {
  return {
    id: row.id,
    key: row.key,
    type: row.type,
    label: row.label,
    description: row.description,
    options: row.options,
    required: row.required,
    subjectEditable: row.subject_editable,
    indexed: row.indexed,
    indexState: row.index_state,
    position: row.position,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FIELD_COLUMNS = sql`id, key, type, label, description, options, required,
  subject_editable, indexed, index_state, position, archived_at, created_at, updated_at`;

export async function createContactField(
  ctx: WorkspaceContext,
  input: CreateFieldInput,
): Promise<{ id: string }> {
  assertFieldKeyAllowed(input.key);

  return withWorkspace(ctx, async (tx) => {
    // Limit se počítá včetně archivovaných polí: jejich hodnoty v attributes zůstávají
    // a klíč zůstává obsazený, takže i archivované pole zabírá místo.
    const count = await tx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM contact_fields
       WHERE workspace_id = ${ctx.workspaceId}::uuid
    `);
    if (count.rows[0]!.total >= CONTACT_FIELD_LIMIT) {
      throw new ApiError('too_many_items', {
        params: { detail: 'field_limit_reached', limit: CONTACT_FIELD_LIMIT },
      });
    }

    const inserted = await tx
      .execute<{ id: string }>(
        sql`
      INSERT INTO contact_fields (workspace_id, key, type, label, description, options,
                                  required, subject_editable, position)
      VALUES (${ctx.workspaceId}::uuid, ${input.key}, ${input.type},
              ${JSON.stringify(input.label)}::jsonb,
              ${JSON.stringify(input.description ?? {})}::jsonb,
              ${JSON.stringify(input.options ?? {})}::jsonb,
              ${input.required ?? false}, ${input.subjectEditable ?? false},
              (SELECT coalesce(max(position), 0) + 1 FROM contact_fields
                WHERE workspace_id = ${ctx.workspaceId}::uuid))
      RETURNING id
    `,
      )
      .catch(rethrowDuplicateKey);

    const id = inserted.rows[0]!.id;
    await writeAudit(tx, ctx, {
      action: 'field.created',
      targetType: 'contact_field',
      targetId: id,
      metadata: { key: input.key, type: input.type },
    });
    return { id };
  });
}

/**
 * Klíč vlastního pole je obsazený i tehdy, když je pole archivované: unikátní index
 * `uq_contact_fields__workspace_key` je ÚPLNÝ, ne částečný. Kdyby šel klíč použít znovu
 * s jiným typem, hodnoty starého pole zůstaly v attributes a segment nad novým polem
 * by je četl jako svoje.
 *
 * SQLSTATE se čte přes `pgErrorCode`, protože Drizzle chybu ovladače balí a `error.code`
 * je undefined; test na `error.code === '23505'` by se nikdy netrefil.
 */
function rethrowDuplicateKey(error: unknown): never {
  if (pgErrorCode(error) === '23505') {
    throw new ApiError('already_exists', { params: { detail: 'field_key_taken' }, cause: error });
  }
  throw error;
}

/**
 * Změna typu existujícího pole je ZAKÁZANÁ. Tichá konverze pěti milionů hodnot je
 * operace bez bezpečné cesty zpět, a šablony i segmenty na typ spoléhají. Uživatel
 * musí založit nové pole a staré archivovat.
 */
export async function updateContactField(
  ctx: WorkspaceContext,
  fieldId: string,
  patch: {
    label?: Record<string, string>;
    description?: Record<string, string>;
    required?: boolean;
    subjectEditable?: boolean;
    type?: ContactFieldType;
  },
): Promise<void> {
  if (patch.type !== undefined) {
    throw new ApiError('conflict', { params: { detail: 'field_type_immutable' } });
  }
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE contact_fields
         SET label = coalesce(${patch.label === undefined ? null : JSON.stringify(patch.label)}::jsonb, label),
             description = coalesce(${patch.description === undefined ? null : JSON.stringify(patch.description)}::jsonb, description),
             required = coalesce(${patch.required ?? null}, required),
             subject_editable = coalesce(${patch.subjectEditable ?? null}, subject_editable),
             updated_at = now()
       WHERE id = ${fieldId} AND workspace_id = ${ctx.workspaceId}::uuid
    `);
  });
}

/** Počty využití limitů. Rozhraní je ukazuje u seznamu polí, viz úkol 65. */
export async function getFieldLimits(
  ctx: WorkspaceContext,
): Promise<{ used: number; limit: number; indexedUsed: number; indexedLimit: number }> {
  return withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ used: number; indexed_used: number }>(sql`
      SELECT count(*)::int AS used,
             count(*) FILTER (WHERE indexed)::int AS indexed_used
        FROM contact_fields WHERE workspace_id = ${ctx.workspaceId}::uuid
    `);
    const row = result.rows[0]!;
    return {
      used: row.used,
      limit: CONTACT_FIELD_LIMIT,
      indexedUsed: row.indexed_used,
      indexedLimit: CONTACT_INDEXED_FIELD_LIMIT,
    };
  });
}

export async function listContactFields(
  ctx: WorkspaceContext,
  options: { includeArchived?: boolean } = {},
): Promise<ContactField[]> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<FieldRow>(sql`
      SELECT ${FIELD_COLUMNS} FROM contact_fields
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND (${options.includeArchived ?? false} OR archived_at IS NULL)
       ORDER BY position, key
    `);
    return rows.map(toField);
  });
}

export async function getContactField(
  ctx: WorkspaceContext,
  fieldId: string,
): Promise<ContactField> {
  return withWorkspace(ctx, async (tx) => {
    const field = await getContactFieldIn(tx, ctx, fieldId);
    if (field === null) throw new ApiError('not_found');
    return field;
  });
}

async function getContactFieldIn(
  tx: Tx,
  ctx: WorkspaceContext,
  fieldId: string,
): Promise<ContactField | null> {
  const { rows } = await tx.execute<FieldRow>(sql`
    SELECT ${FIELD_COLUMNS} FROM contact_fields
     WHERE id = ${fieldId} AND workspace_id = ${ctx.workspaceId}::uuid
  `);
  const row = rows[0];
  return row === undefined ? null : toField(row);
}

/**
 * Archivace je měkká a bezpečná: pole zmizí z rozhraní a z nabídky merge tagů, ale
 * hodnoty v attributes zůstanou, segmenty dál fungují a šablony se nerozbijí.
 * Není to měkké mazání, proto se sloupec jmenuje archived_at a ne deleted_at,
 * a proto je unikátní index nad klíčem ÚPLNÝ: klíč archivovaného pole se nesmí
 * dát znovu použít s jiným typem.
 */
export async function archiveContactField(ctx: WorkspaceContext, fieldId: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE contact_fields SET archived_at = now(), updated_at = now()
       WHERE id = ${fieldId} AND workspace_id = ${ctx.workspaceId}::uuid AND archived_at IS NULL
    `);
    await writeAudit(tx, ctx, {
      action: 'field.archived',
      targetType: 'contact_field',
      targetId: fieldId,
      metadata: {},
    });
  });
}

/**
 * Fáze 1 dvoufázového smazání: co se rozbije.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ POŘADÍM VLN. Plán volal `findTemplatesUsingField`
 * z `@mlain/core/templates` (P08) a `findScheduledCampaignsUsingField`
 * z `@mlain/core/campaigns` (P13). Ani jeden modul dnes v repozitáři není, takže by se
 * import nepřeložil. Schéma ale obě informace nese přímo a indexovaně:
 * `templates.used_fields` (GIN index `idx_templates__used_fields`) a
 * `campaigns.compiled_fields`. Dotazuje se tedy na ně a až P08 a P13 své funkce vystaví,
 * nahradí se dvě SQL dotazy za dvě volání, aniž by se měnil tvar `FieldImpact`.
 */
export async function getFieldImpact(ctx: WorkspaceContext, fieldId: string): Promise<FieldImpact> {
  return withWorkspace(ctx, async (tx) => {
    const field = await getContactFieldIn(tx, ctx, fieldId);
    if (field === null) throw new ApiError('not_found');
    const path = `attr.${field.key}`;

    const counted = await tx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL
         AND attributes ? ${field.key}
    `);

    const segments = await tx.execute<{ id: string; name: string }>(sql`
      SELECT id, name FROM segments
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL
         AND definition::text LIKE ${'%' + field.key + '%'}
    `);

    const forms = await tx.execute<{ id: string; name: string }>(sql`
      SELECT id, name FROM forms
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND fields::text LIKE ${'%' + field.key + '%'}
    `);

    const templates = await tx.execute<{ id: string; name: string }>(sql`
      SELECT id, name FROM templates
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL
         AND ${path} = ANY(used_fields)
    `);

    // Naplánovaná kampaň je každá, která už nejde jen tak přepsat: čeká na odeslání,
    // právě se staví, odesílá se, nebo je pozastavená uprostřed rozesílky.
    const campaigns = await tx.execute<{ id: string; name: string }>(sql`
      SELECT id, name FROM campaigns
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND status IN ('scheduled', 'queueing', 'sending', 'paused')
         AND ${path} = ANY(compiled_fields)
    `);

    return {
      contacts_with_value: counted.rows[0]!.total,
      segments: segments.rows,
      forms: forms.rows,
      templates: templates.rows.map((t) => ({ id: t.id, name: t.name, usages: 1 })),
      campaigns_scheduled: campaigns.rows,
    };
  });
}

/**
 * Fáze 2: smazání. Nevratné a dotýká se tří cizích území, proto tři joby.
 *
 * content.revalidate_templates je POVINNÁ součást, ne volitelný doplněk. Řešit segmenty
 * a neřešit šablony by znamenalo, že uživatel zjistí chybějící pole teprve tím, že mu
 * odejde kampaň s prázdným místem uprostřed věty.
 */
export async function deleteContactField(ctx: WorkspaceContext, fieldId: string): Promise<void> {
  const impact = await getFieldImpact(ctx, fieldId);
  if (isDeletionBlocked(impact)) {
    throw new ApiError('conflict', {
      params: {
        detail: 'field_used_by_scheduled_campaign',
        campaigns: impact.campaigns_scheduled.map((c) => c.id),
      },
    });
  }

  const field = await getContactField(ctx, fieldId);

  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      DELETE FROM contact_fields
       WHERE id = ${fieldId} AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    await writeAudit(tx, ctx, {
      action: 'field.deleted',
      targetType: 'contact_field',
      targetId: fieldId,
      metadata: { key: field.key, contacts_with_value: impact.contacts_with_value },
    });

    await enqueue(tx, 'contacts.strip_attribute', {
      workspaceId: ctx.workspaceId,
      key: field.key,
    });
    await enqueue(tx, 'content.revalidate_templates', {
      workspaceId: ctx.workspaceId,
      path: `attr.${field.key}`,
    });
    await enqueue(tx, 'segments.mark_invalid', {
      workspaceId: ctx.workspaceId,
      segmentIds: impact.segments.map((s) => s.id),
      errorCode: 'segment_field_missing',
    });
  });
}

/**
 * Vlastní pole, které NENÍ prověřené, se v segmentu použít smí. Kompilátor jen
 * do náhledu přidá varování segment_unindexed_field a rozhraní vysvětlí, že dotaz
 * projde všechny kontakty. Limit osmi existuje proto, že prověřená pole nabízí
 * rozhraní jako "rychlá" a osm je počet, který se do nabídky vejde bez rolování.
 */
export async function requestFieldIndex(ctx: WorkspaceContext, fieldId: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    // Počítá se indexed I building. Kdyby se počítalo jen indexed, prošlo by
    // osm souběžných žádostí najednou a limit by začal platit až ve chvíli,
    // kdy jsou joby hotové, tedy když už ho není potřeba.
    const { rows: counted } = await tx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM contact_fields
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND archived_at IS NULL
         AND (indexed OR index_state = 'building')
         AND id <> ${fieldId}
    `);
    if (counted[0]!.total >= CONTACT_INDEXED_FIELD_LIMIT) {
      throw new ApiError('too_many_items', {
        params: { detail: 'indexed_field_limit_reached', limit: CONTACT_INDEXED_FIELD_LIMIT },
      });
    }
    await tx.execute(sql`
      UPDATE contact_fields SET index_state = 'building', updated_at = now()
       WHERE id = ${fieldId} AND workspace_id = ${ctx.workspaceId}::uuid
         AND archived_at IS NULL
    `);
    await writeAudit(tx, ctx, {
      action: 'field.indexed',
      targetType: 'contact_field',
      targetId: fieldId,
      metadata: {},
    });
    await enqueue(tx, 'contact_fields.verify_index', {
      workspaceId: ctx.workspaceId,
      fieldId,
    });
  });
}
