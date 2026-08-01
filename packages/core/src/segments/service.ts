import { and, eq, isNull } from 'drizzle-orm';
import { segments } from '@mlain/db/schema';
import { ApiError } from '../errors/api-error';
import type { WorkspaceContext } from '../identity/types';
import { wsEq } from '../identity/scope';
import { pgErrorCode, withWorkspace, type Tx } from '../tx';
import { SegmentAstV1, type SegmentAst } from './ast';
import { assertWithinLimits } from './limits';
import { definitionHash } from './canonical';
import { resolveReferences } from './references';
import { toSql } from './compile/params';
import { compileAudienceToSql, countSegment } from './repo';
import { actorUserId, auditSegment } from './audit';
import { enqueueSegmentJob } from './jobs/enqueue';

export const SEGMENTS_RECOUNT_QUEUE = 'segments.recount';

export type SegmentRow = {
  id: string;
  name: string;
  description: string | null;
  kind: 'dynamic' | 'static';
  presetKey: string | null;
  definition: SegmentAst;
  definitionHash: Buffer;
  cachedCount: number | null;
  cachedIsExact: boolean | null;
  cachedAt: Date | null;
  cachedDurationMs: number | null;
  recomputeState: 'idle' | 'queued' | 'running' | 'error';
  lastErrorCode: string | null;
};

const STALE_MINUTES = 15;

async function validate(
  ctx: WorkspaceContext,
  definition: SegmentAst,
  selfId?: string,
): Promise<void> {
  const ast = SegmentAstV1.parse(definition);
  assertWithinLimits(ast);
  await resolveReferences(ctx, ast, selfId === undefined ? {} : { selfId });
}

function conflictOnDuplicateName(error: unknown): never {
  if (pgErrorCode(error) === '23505') {
    throw new ApiError('already_exists', { params: { code: 'segment_name_taken' } });
  }
  throw error;
}

export async function createSegment(
  ctx: WorkspaceContext,
  input: { name: string; description?: string; definition: SegmentAst; presetKey?: string },
): Promise<SegmentRow> {
  await validate(ctx, input.definition);
  return withWorkspace(ctx, async (tx: Tx) => {
    const hash = definitionHash(input.definition);
    const inserted = await tx
      .insert(segments)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        description: input.description ?? null,
        kind: 'dynamic',
        presetKey: input.presetKey ?? null,
        definition: input.definition,
        definitionHash: hash,
        createdBy: actorUserId(ctx),
        // `queued` ve STEJNÉ transakci jako zařazení do fronty níž, jinak by se
        // stav a fronta rozešly při pádu mezi nimi a segment by navždy tvrdil
        // „čeká na přepočet".
        recomputeState: 'queued',
      })
      .returning()
      .catch(conflictOnDuplicateName);
    const row = inserted[0] as SegmentRow | undefined;
    if (row === undefined) {
      throw new ApiError('already_exists', { params: { code: 'segment_name_taken' } });
    }
    await auditSegment(tx, ctx, 'segment.created', row.id, { name: input.name });
    await enqueueSegmentJob(
      tx,
      SEGMENTS_RECOUNT_QUEUE,
      { workspaceId: ctx.workspaceId, segmentId: row.id },
      { singletonKey: row.id },
    );
    return row;
  });
}

export async function updateSegment(
  ctx: WorkspaceContext,
  id: string,
  patch: { name?: string; description?: string; definition?: SegmentAst },
): Promise<SegmentRow> {
  if (patch.definition) await validate(ctx, patch.definition, id);
  return withWorkspace(ctx, async (tx: Tx) => {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) values['name'] = patch.name;
    if (patch.description !== undefined) values['description'] = patch.description;
    if (patch.definition) {
      values['definition'] = patch.definition;
      values['definitionHash'] = definitionHash(patch.definition);
      // Změna definice zneplatňuje cache. Zastaralé číslo u změněné definice
      // je horší než žádné, protože vypadá stejně čerstvě jako správné.
      values['cachedAt'] = null;
      values['cachedCount'] = null;
      values['cachedIsExact'] = null;
      values['recomputeState'] = 'queued';
      values['lastErrorCode'] = null;
    }
    const rows = await tx
      .update(segments)
      .set(values)
      .where(and(wsEq(ctx, segments), eq(segments.id, id), isNull(segments.deletedAt)))
      .returning()
      .catch(conflictOnDuplicateName);
    const row = rows[0] as SegmentRow | undefined;
    if (row === undefined) {
      throw new ApiError('not_found', { params: { code: 'segment_not_found', id } });
    }
    await auditSegment(tx, ctx, 'segment.updated', id, {});
    if (patch.definition) {
      await enqueueSegmentJob(
        tx,
        SEGMENTS_RECOUNT_QUEUE,
        { workspaceId: ctx.workspaceId, segmentId: id },
        { singletonKey: id },
      );
    }
    return row;
  });
}

export async function deleteSegment(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx: Tx) => {
    await tx
      .update(segments)
      .set({ deletedAt: new Date() })
      .where(and(wsEq(ctx, segments), eq(segments.id, id)));
    await auditSegment(tx, ctx, 'segment.deleted', id, {});
  });
}

export async function getSegment(ctx: WorkspaceContext, id: string): Promise<SegmentRow> {
  const rows = await withWorkspace(ctx, (tx: Tx) =>
    tx
      .select()
      .from(segments)
      .where(and(wsEq(ctx, segments), eq(segments.id, id), isNull(segments.deletedAt))),
  );
  const row = (rows as SegmentRow[])[0];
  if (row === undefined) {
    throw new ApiError('not_found', { params: { code: 'segment_not_found', id } });
  }
  return row;
}

export async function listSegments(
  ctx: WorkspaceContext,
  page: { limit: number },
): Promise<{ rows: SegmentRow[]; hasMore: boolean }> {
  const rows = await withWorkspace(ctx, async (tx: Tx) => {
    const found = (await tx
      .select()
      .from(segments)
      .where(and(wsEq(ctx, segments), isNull(segments.deletedAt)))
      .orderBy(segments.createdAt)
      .limit(page.limit + 1)) as SegmentRow[];
    // Otevření seznamu zařadí přepočet u všeho staršího než 15 minut.
    const stale = found.filter(
      (r) =>
        r.kind === 'dynamic' &&
        (r.cachedAt === null || Date.now() - r.cachedAt.getTime() > STALE_MINUTES * 60_000),
    );
    for (const row of stale) {
      await enqueueSegmentJob(
        tx,
        SEGMENTS_RECOUNT_QUEUE,
        { workspaceId: ctx.workspaceId, segmentId: row.id },
        { singletonKey: row.id },
      );
    }
    return found;
  });
  return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
}

/**
 * Dokončení importu označí za zastaralé jen DYNAMICKÉ segmenty projektu.
 *
 * Statický segment je zmrazená množina: jeho členové se importem nezmění,
 * protože se čtou ze `segment_members`. Bez podmínky na `kind` by zmrazený
 * segment přišel o razítko zmrazení, karta by u něj místo data ukázala
 * „nikdy nepočítáno" a nabídla přepočet, který u statického segmentu nedává
 * smysl a jehož výsledek by se ani neuložil.
 */
export async function markAllStale(ctx: WorkspaceContext): Promise<void> {
  await withWorkspace(ctx, (tx: Tx) =>
    tx
      .update(segments)
      .set({ cachedAt: null })
      .where(and(wsEq(ctx, segments), isNull(segments.deletedAt), eq(segments.kind, 'dynamic'))),
  );
}

/**
 * Zmrazení do statického segmentu. `asOf` je čas zmrazení, takže výsledek jde
 * kdykoliv zreprodukovat, a členové se zapisují jedním INSERT ... SELECT,
 * ne po řádcích.
 */
export async function freezeSegment(
  ctx: WorkspaceContext,
  id: string,
  input: { name: string },
): Promise<SegmentRow> {
  const asOf = new Date();
  const row = await getSegment(ctx, id);

  const compiled = await compileAudienceToSql(
    ctx,
    { ast: row.definition },
    {
      alias: 'a',
      paramOffset: 0,
      asOf,
      timezone: 'Europe/Prague',
    },
  );

  return withWorkspace(ctx, async (tx: Tx) => {
    const inserted = await tx
      .insert(segments)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        kind: 'static',
        presetKey: row.presetKey,
        definition: row.definition,
        definitionHash: row.definitionHash,
        createdBy: actorUserId(ctx),
      })
      .returning()
      .catch(conflictOnDuplicateName);
    const frozen = inserted[0] as SegmentRow;
    // Text kompilátoru se vkládá přes toSql, které si placeholdery $n napáruje
    // na hodnoty. Doplněné id nového segmentu dostane vlastní číslo na konci,
    // takže se číslování zbytku nikam neposune.
    const memberText =
      `INSERT INTO segment_members (segment_id, contact_id, workspace_id)\n` +
      `SELECT $${compiled.params.length + 1}::uuid, contact_id, $1 FROM (${compiled.sql}) src\n` +
      `ON CONFLICT DO NOTHING`;
    const inserting = await tx.execute(toSql(memberText, [...compiled.params, frozen.id]));
    // Počet se čte z počtu vložených řádků, ne dalším dotazem: ON CONFLICT DO NOTHING
    // sice může některé přeskočit, ale segment je nový, takže konflikt nastat nemůže
    // a druhý dotaz by byl jen další skenování stejné množiny.
    const count = inserting.rowCount ?? 0;
    const updated = await tx
      .update(segments)
      .set({
        cachedCount: count,
        cachedIsExact: true,
        cachedAt: asOf,
        recomputeState: 'idle',
      })
      .where(and(wsEq(ctx, segments), eq(segments.id, frozen.id)))
      .returning();
    await auditSegment(tx, ctx, 'segment.frozen', frozen.id, { sourceSegmentId: id, count });
    return updated[0] as SegmentRow;
  });
}

export async function recountSegment(ctx: WorkspaceContext, id: string): Promise<SegmentRow> {
  const row = await getSegment(ctx, id);
  const started = Date.now();
  const out = await countSegment(ctx, row.definition, { timeoutMs: 60_000, asOf: new Date() });
  return withWorkspace(ctx, async (tx: Tx) => {
    const updated = await tx
      .update(segments)
      .set({
        cachedCount: out.count,
        cachedIsExact: out.exact,
        cachedAt: new Date(),
        cachedDurationMs: Date.now() - started,
        recomputeState: 'idle',
        lastErrorCode: null,
      })
      .where(and(wsEq(ctx, segments), eq(segments.id, id)))
      .returning();
    return updated[0] as SegmentRow;
  });
}

export function segmentFreshness(
  cachedAt: Date | null,
  now = new Date(),
): 'never' | 'fresh' | 'recent' | 'stale' {
  if (cachedAt === null) return 'never';
  const minutes = (now.getTime() - cachedAt.getTime()) / 60_000;
  if (minutes <= 15) return 'fresh';
  if (minutes <= 360) return 'recent';
  return 'stale';
}
