import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { pgErrorCode, withWorkspace } from '../../tx';
import { writeAudit } from '../audit';
import { enqueue } from '../jobs/enqueue';

export const TAG_LIMIT_PER_WORKSPACE = 500;
export const TAG_LIMIT_PER_CONTACT = 50;
/** Nad kolik kontaktů se hromadné označení přesune do jobu s ukazatelem průběhu. */
export const BULK_TAG_SYNC_LIMIT = 10000;

export type Tag = { id: string; name: string; color: string | null; description: string | null };

export async function createTag(
  ctx: WorkspaceContext,
  input: { name: string; color?: string; description?: string },
): Promise<{ id: string }> {
  return withWorkspace(ctx, async (tx) => {
    const counted = await tx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM tags WHERE workspace_id = ${ctx.workspaceId}::uuid
    `);
    if (counted.rows[0]!.total >= TAG_LIMIT_PER_WORKSPACE) {
      throw new ApiError('too_many_items', {
        params: { detail: 'tag_limit_reached', limit: TAG_LIMIT_PER_WORKSPACE },
      });
    }

    // Unikátnost hlídá index nad lower(name). Štítky se zadávají volným textem
    // a kolize na velikosti písmen je nejčastější chyba, kterou uživatel udělá.
    const inserted = await tx
      .execute<{ id: string }>(
        sql`
      INSERT INTO tags (workspace_id, name, color, description)
      VALUES (${ctx.workspaceId}::uuid, ${input.name}, ${input.color ?? null},
              ${input.description ?? null})
      RETURNING id
    `,
      )
      .catch(rethrowDuplicateName);

    const id = inserted.rows[0]!.id;
    await writeAudit(tx, ctx, {
      action: 'tag.created',
      targetType: 'tag',
      targetId: id,
      metadata: { name: input.name },
    });
    return { id };
  });
}

/**
 * SQLSTATE se čte přes `pgErrorCode`, protože Drizzle chybu ovladače balí do
 * `DrizzleQueryError` a `error.code` je undefined. Test na `error.code === '23505'`
 * by se nikdy netrefil a uživatel by místo "jméno je obsazené" dostal internal_error.
 */
function rethrowDuplicateName(error: unknown): never {
  if (pgErrorCode(error) === '23505') {
    throw new ApiError('already_exists', { params: { detail: 'tag_name_taken' }, cause: error });
  }
  throw error;
}

export async function renameTag(ctx: WorkspaceContext, tagId: string, name: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    // Přejmenování je čistá operace nad jménem. Vazby v contact_tags se nekopírují
    // ani nepřepisují, protože ukazují na id, ne na text.
    await tx
      .execute(
        sql`
      UPDATE tags SET name = ${name}
       WHERE id = ${tagId} AND workspace_id = ${ctx.workspaceId}::uuid
    `,
      )
      .catch(rethrowDuplicateName);
  });
}

export async function listTags(ctx: WorkspaceContext): Promise<Tag[]> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<Tag>(sql`
      SELECT id, name, color, description FROM tags
       WHERE workspace_id = ${ctx.workspaceId}::uuid
       ORDER BY lower(name)
    `);
    return rows;
  });
}

export async function addTagsToContact(
  ctx: WorkspaceContext,
  contactId: string,
  tagIds: readonly string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  await withWorkspace(ctx, async (tx) => {
    // Počítá se, kolik štítků kontakt SKUTEČNĚ přibude: opakované přiřazení téhož
    // štítku limit nevyčerpává, protože ON CONFLICT DO NOTHING žádný řádek nepřidá.
    const counted = await tx.execute<{ total: number; adding: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM contact_tags
          WHERE contact_id = ${contactId} AND workspace_id = ${ctx.workspaceId}::uuid) AS total,
        (SELECT count(*)::int FROM unnest(${sql.param([...tagIds])}::uuid[]) AS t
          WHERE NOT EXISTS (SELECT 1 FROM contact_tags ct
                             WHERE ct.contact_id = ${contactId} AND ct.tag_id = t)) AS adding
    `);
    const row = counted.rows[0]!;
    if (row.total + row.adding > TAG_LIMIT_PER_CONTACT) {
      throw new ApiError('too_many_items', {
        params: { detail: 'contact_tag_limit_reached', limit: TAG_LIMIT_PER_CONTACT },
      });
    }
    await tx.execute(sql`
      INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
      SELECT ${contactId}, t, ${ctx.workspaceId}::uuid FROM unnest(${sql.param([...tagIds])}::uuid[]) AS t
      ON CONFLICT (contact_id, tag_id) DO NOTHING
    `);
  });
}

export async function removeTagFromContact(
  ctx: WorkspaceContext,
  contactId: string,
  tagId: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      DELETE FROM contact_tags
       WHERE contact_id = ${contactId} AND tag_id = ${tagId}
         AND workspace_id = ${ctx.workspaceId}::uuid
    `);
  });
}

/**
 * Sloučení dvou štítků. Přepíše vazby a zdrojový štítek smaže, celé v jedné transakci.
 *
 * ON CONFLICT DO NOTHING je nutné kvůli kontaktům, které mají oba štítky: bez něj
 * by UPDATE porušil primární klíč (contact_id, tag_id) a sloučení by spadlo přesně
 * u těch kontaktů, kvůli kterým uživatel štítky slučuje.
 */
export async function mergeTags(
  ctx: WorkspaceContext,
  sourceTagId: string,
  targetTagId: string,
): Promise<void> {
  if (sourceTagId === targetTagId) return;
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
      SELECT contact_id, ${targetTagId}, ${ctx.workspaceId}::uuid
        FROM contact_tags
       WHERE tag_id = ${sourceTagId} AND workspace_id = ${ctx.workspaceId}::uuid
      ON CONFLICT (contact_id, tag_id) DO NOTHING
    `);
    await tx.execute(sql`
      DELETE FROM tags WHERE id = ${sourceTagId} AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    await writeAudit(tx, ctx, {
      action: 'tag.merged',
      targetType: 'tag',
      targetId: targetTagId,
      metadata: { merged_from: sourceTagId },
    });
  });
}

export type BulkTagInput = {
  filter: { ids: string[] };
  add?: string[];
  remove?: string[];
};

export type BulkTagOutcome =
  { mode: 'sync'; tagged: number; untagged: number } | { mode: 'queued' };

/**
 * Hromadné označení. Do BULK_TAG_SYNC_LIMIT kontaktů se provede rovnou, nad ním se
 * předá jobu s ukazatelem průběhu: HTTP požadavek, který drží transakci nad statisíci
 * řádky, vyprší dřív, než doběhne, a uživatel neví, jestli se něco stalo.
 */
export async function bulkTagContacts(
  ctx: WorkspaceContext,
  input: BulkTagInput,
): Promise<BulkTagOutcome> {
  const ids = input.filter.ids;
  const add = input.add ?? [];
  const remove = input.remove ?? [];

  if (ids.length > BULK_TAG_SYNC_LIMIT) {
    await withWorkspace(ctx, async (tx) => {
      await enqueue(
        tx,
        'contacts.bulk_tag',
        { workspaceId: ctx.workspaceId, contactIds: ids, add, remove },
        { singletonKey: ctx.workspaceId },
      );
    });
    return { mode: 'queued' };
  }

  let tagged = 0;
  let untagged = 0;
  await withWorkspace(ctx, async (tx) => {
    if (add.length > 0) {
      const result = await tx.execute<{ contact_id: string }>(sql`
        INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
        SELECT c, t, ${ctx.workspaceId}::uuid
          FROM unnest(${sql.param(ids)}::uuid[]) AS c
         CROSS JOIN unnest(${sql.param(add)}::uuid[]) AS t
        ON CONFLICT (contact_id, tag_id) DO NOTHING
        RETURNING contact_id
      `);
      tagged = result.rows.length;
    }
    if (remove.length > 0) {
      const result = await tx.execute<{ contact_id: string }>(sql`
        DELETE FROM contact_tags
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND contact_id = ANY(${sql.param(ids)}::uuid[])
           AND tag_id = ANY(${sql.param(remove)}::uuid[])
        RETURNING contact_id
      `);
      untagged = result.rows.length;
    }
  });
  return { mode: 'sync', tagged, untagged };
}

/* ------------------------------------------------------------------------- *
 * Čtení a úpravy pro REST API (úkol 51).
 *
 * Plán volal `tagsRepo.list/create/patch/remove/merge/bulkAssign`. V repozitáři
 * existovaly jen zápisové operace a `listTags()` bez počtu kontaktů a bez
 * stránkování, takže obrazovka ani API stránku sestavit nemohly. Funkce níž jsou
 * doplněk, ne druhá implementace: zápisy pořád vedou přes createTag, renameTag
 * a mergeTags výš.
 * ------------------------------------------------------------------------- */

export type TagWithCount = {
  id: string;
  name: string;
  color: string | null;
  contact_count: number;
  created_at: Date | string;
};

export type TagPageQuery = {
  limit: number;
  cursor?: string | undefined;
  order: string;
  q?: string | undefined;
};

export type TagPage = { rows: TagWithCount[]; nextCursor: string | null; hasMore: boolean };

/**
 * Stránka štítků i s počtem kontaktů. Počet se počítá poddotazem nad
 * `idx_contact_tags__ws_tag_contact`, tedy index only scanem, ne joinem přes celou
 * tabulku vazeb.
 */
export async function listTagsPage(ctx: WorkspaceContext, query: TagPageQuery): Promise<TagPage> {
  const byName = query.order === 'name.asc';
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<TagWithCount>(sql`
      SELECT t.id, t.name, t.color, t.created_at,
             (SELECT count(*)::int FROM contact_tags ct
               WHERE ct.tag_id = t.id AND ct.workspace_id = t.workspace_id) AS contact_count
        FROM tags t
       WHERE t.workspace_id = ${ctx.workspaceId}::uuid
         AND (${query.q ?? null}::text IS NULL OR lower(t.name) LIKE lower(${`%${query.q ?? ''}%`}))
         AND (${query.cursor ?? null}::text IS NULL OR
              (${byName} AND lower(t.name) > lower(${query.cursor ?? ''})) OR
              (NOT ${byName} AND t.id < ${query.cursor ?? '00000000-0000-0000-0000-000000000000'}::uuid))
       ORDER BY ${byName ? sql`lower(t.name) ASC` : sql`t.id DESC`}
       LIMIT ${query.limit + 1}
    `);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: hasMore && last !== undefined ? (byName ? last.name : last.id) : null,
      hasMore,
    };
  });
}

export async function getTag(ctx: WorkspaceContext, tagId: string): Promise<TagWithCount | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<TagWithCount>(sql`
      SELECT t.id, t.name, t.color, t.created_at,
             (SELECT count(*)::int FROM contact_tags ct
               WHERE ct.tag_id = t.id AND ct.workspace_id = t.workspace_id) AS contact_count
        FROM tags t
       WHERE t.workspace_id = ${ctx.workspaceId}::uuid AND t.id = ${tagId}::uuid
    `);
    return rows[0] ?? null;
  });
}

/** Změna jména nebo barvy. Vrací false, když štítek v projektu není. */
export async function updateTag(
  ctx: WorkspaceContext,
  tagId: string,
  patch: { name?: string | undefined; color?: string | null | undefined },
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const result = await tx
      .execute<{ id: string }>(
        sql`
      UPDATE tags
         SET name = coalesce(${patch.name ?? null}::text, name),
             color = ${patch.color === undefined ? sql`color` : patch.color}
       WHERE id = ${tagId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
      RETURNING id
    `,
      )
      .catch(rethrowDuplicateName);
    return result.rows.length > 0;
  });
}

/** Smazání štítku. Vazby padají kaskádou, kontakty zůstávají. */
export async function deleteTag(ctx: WorkspaceContext, tagId: string): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      DELETE FROM tags WHERE id = ${tagId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
      RETURNING id
    `);
    if (result.rows.length === 0) return false;
    await writeAudit(tx, ctx, {
      action: 'tag.deleted',
      targetType: 'tag',
      targetId: tagId,
      metadata: {},
    });
    return true;
  });
}

/**
 * Štítky podle JMÉNA, ne podle id. Používá je zápis kontaktu přes API, formulář
 * a webhook, protože tyhle tři kanály jména znají a id ne.
 *
 * ON CONFLICT míří na výraz `lower(name)`, protože přesně tak vypadá
 * `uq_tags__workspace_name`. Cílit na `(workspace_id, name)` by skončilo na 42P10,
 * protože takový index neexistuje.
 */
export async function ensureTags(
  ctx: WorkspaceContext,
  names: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))];
  if (unique.length === 0) return [];

  return withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      INSERT INTO tags (workspace_id, name)
      SELECT ${ctx.workspaceId}::uuid, n FROM unnest(${sql.param(unique)}::text[]) AS n
      ON CONFLICT (workspace_id, lower(name)) DO NOTHING
    `);
    const { rows } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM tags
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND lower(name) = ANY(SELECT lower(n) FROM unnest(${sql.param(unique)}::text[]) AS n)
    `);
    return rows.map((row) => row.id);
  });
}
