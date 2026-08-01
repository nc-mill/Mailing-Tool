import { and, inArray } from 'drizzle-orm';
import { contactFields, lists, segments, tags } from '@mlain/db/schema';
import type { WorkspaceContext } from '../identity/types';
import { wsEq } from '../identity/scope';
import { withWorkspace, type Tx } from '../tx';
import { SEGMENT_LIMITS } from './limits';
import { customFieldClass, type FieldClass } from './operators';
import { referenceNotFound, tooMany } from './errors';
import type { Node, SegmentAst } from './ast';

export type ResolvedReferences = {
  fieldClasses: Record<string, FieldClass>;
  segmentKinds: Record<string, { kind: 'static' | 'dynamic'; ast?: SegmentAst }>;
  archivedFields: string[];
  /**
   * Pole, u kterých kompilátor neumí podmínku přeložit na `@>`, tedy na jediný
   * operátor, který index `idx_contacts__attributes_gin` s třídou
   * `jsonb_path_ops` obsluhuje (rozhodnutí R19). Sloupce `contact_fields.indexed`
   * a `index_state` se ZÁMĚRNĚ nečtou: nikdo je nezapisuje, takže by varování
   * svítilo u každého vlastního pole navždy a uživatel by se ho naučil ignorovat.
   */
  unindexedFields: string[];
};

type Wanted = {
  attrs: Set<string>;
  lists: Set<string>;
  tags: Set<string>;
  segments: Set<string>;
};

function emptyWanted(): Wanted {
  return { attrs: new Set(), lists: new Set(), tags: new Set(), segments: new Set() };
}

/** Operátory nad vlastním polem, které se dají obsloužit indexem. */
const INDEXABLE_OPERATORS = new Set(['eq', 'has_any', 'has_all']);

function collect(node: Node, out: Wanted, unindexable: Set<string>): void {
  if (node.type === 'group') {
    for (const child of node.children) collect(child, out, unindexable);
    return;
  }
  switch (node.field.kind) {
    case 'attribute':
      out.attrs.add(node.field.key);
      if (!INDEXABLE_OPERATORS.has(node.operator)) unindexable.add(node.field.key);
      break;
    case 'list':
      out.lists.add(node.field.list_id);
      break;
    case 'segment':
      out.segments.add(node.field.segment_id);
      break;
    case 'tag':
      for (const v of node.values ?? []) out.tags.add(String(v));
      break;
    default:
      break;
  }
}

export function assertNoCycle(rootId: string, graph: Map<string, string[]>): void {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) tooMany('segment_cycle', { at: id });
    if (done.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) walk(next);
    visiting.delete(id);
    done.add(id);
  };
  walk(rootId);
}

export function assertNestingDepth(rootId: string, graph: Map<string, string[]>): void {
  const depth = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const children = graph.get(id) ?? [];
    return children.length === 0 ? 0 : 1 + Math.max(...children.map((c) => depth(c, seen)));
  };
  const found = depth(rootId, new Set());
  if (found > SEGMENT_LIMITS.maxSegmentNesting) {
    tooMany('segment_nesting_too_deep', {
      limit: SEGMENT_LIMITS.maxSegmentNesting,
      got: found,
    });
  }
}

export type ResolveOptions = {
  /**
   * Identifikátor segmentu, jehož definice se právě ověřuje.
   *
   * Bez něj detekce cyklu MLČÍ v tom jediném případě, který v provozu nastane:
   * úprava existujícího segmentu A na odkaz na B, který už odkazuje na A.
   * Graf se skládá z ULOŽENÝCH definic, takže uzel A by v něm nesl svou starou
   * definici bez odkazu a smyčka by se nikde neuzavřela. Uzel A se proto seřadí
   * z NOVÉ definice a prochází se od něj.
   */
  selfId?: string;
};

/**
 * Ověří, že každý odkaz v AST patří do tohohle projektu, a načte, co kompilátor
 * potřebuje: třídu každého vlastního pole a druh každého odkazovaného segmentu.
 * Cizí nebo neexistující ID končí 404, nikdy prázdným výsledkem.
 */
export async function resolveReferences(
  ctx: WorkspaceContext,
  ast: SegmentAst,
  opts: ResolveOptions = {},
): Promise<ResolvedReferences> {
  const wanted = emptyWanted();
  const unindexable = new Set<string>();
  collect(ast.root, wanted, unindexable);

  return withWorkspace(ctx, async (tx: Tx) => {
    const out: ResolvedReferences = {
      fieldClasses: {},
      segmentKinds: {},
      archivedFields: [],
      unindexedFields: [],
    };

    if (wanted.attrs.size > 0) {
      const rows = await tx
        .select()
        .from(contactFields)
        .where(and(wsEq(ctx, contactFields), inArray(contactFields.key, [...wanted.attrs])));
      const found = new Map(rows.map((r) => [r.key, r]));
      for (const key of wanted.attrs) {
        const row = found.get(key);
        if (row === undefined) referenceNotFound('contact_field', key);
        out.fieldClasses[key] = customFieldClass(row.type);
        if (row.archivedAt !== null) out.archivedFields.push(key);
        if (unindexable.has(key)) out.unindexedFields.push(key);
      }
    }

    if (wanted.lists.size > 0) {
      const rows = await tx
        .select({ id: lists.id })
        .from(lists)
        .where(and(wsEq(ctx, lists), inArray(lists.id, [...wanted.lists])));
      const found = new Set(rows.map((r) => r.id));
      for (const id of wanted.lists) if (!found.has(id)) referenceNotFound('list', id);
    }

    if (wanted.tags.size > 0) {
      const rows = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(wsEq(ctx, tags), inArray(tags.id, [...wanted.tags])));
      const found = new Set(rows.map((r) => r.id));
      for (const id of wanted.tags) if (!found.has(id)) referenceNotFound('tag', id);
    }

    if (wanted.segments.size > 0) {
      const graph = new Map<string, string[]>();
      const queue = [...wanted.segments];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const id = queue.shift() as string;
        if (seen.has(id)) continue;
        seen.add(id);
        const rows = await tx
          .select()
          .from(segments)
          .where(and(wsEq(ctx, segments), inArray(segments.id, [id])));
        const row = rows[0];
        if (row === undefined || row.deletedAt !== null) referenceNotFound('segment', id);
        const childAst = row.kind === 'dynamic' ? (row.definition as SegmentAst) : undefined;
        out.segmentKinds[id] =
          childAst === undefined ? { kind: row.kind } : { kind: row.kind, ast: childAst };
        const nested = emptyWanted();
        if (childAst !== undefined) collect(childAst.root, nested, new Set());
        graph.set(id, [...nested.segments]);
        queue.push(...nested.segments);
      }
      // Uzel, ze kterého se prochází, nese NOVOU definici. U úpravy je to sám
      // upravovaný segment, u založení zástupný kořen, který ještě id nemá.
      const rootKey = opts.selfId ?? '__root__';
      graph.set(rootKey, [...wanted.segments]);
      assertNoCycle(rootKey, graph);
      assertNestingDepth(rootKey, graph);
    }

    return out;
  });
}
