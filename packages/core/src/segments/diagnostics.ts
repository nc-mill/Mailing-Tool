import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../identity/types';
import type { ConditionNode, Node, SegmentAst } from './ast';
import { countSegment } from './repo';
import { runReadOnly } from './sql-runner';

export type ConditionCount = { path: number[]; label: string; count: number };
export type EmptyDiagnostics = {
  perCondition: ConditionCount[];
  mostRestrictive: ConditionCount | null;
  fieldStats: {
    key: string;
    filled: number;
    total: number;
    topValues: { value: string; count: number }[];
  } | null;
};

function flatten(node: Node, path: number[] = []): { node: ConditionNode; path: number[] }[] {
  if (node.type === 'condition') return [{ node, path }];
  return node.children.flatMap((child, index) => flatten(child, [...path, index]));
}

/**
 * Běží JEN při prázdném výsledku, takže dodatečné dotazy nikoho nezpomalují.
 * Netechnický člověk neumí přečíst logický výraz, ale okamžitě pochopí větu
 * „tahle jedna podmínka vrací nula".
 */
export async function diagnoseEmptyResult(
  ctx: WorkspaceContext,
  ast: SegmentAst,
  opts: { asOf: Date; timezone: string },
): Promise<EmptyDiagnostics> {
  const leaves = flatten(ast.root);
  const perCondition: ConditionCount[] = [];
  for (const leaf of leaves) {
    const single: SegmentAst = {
      version: 1,
      root: { type: 'group', op: 'and', children: [leaf.node] },
    };
    const out = await countSegment(ctx, single, {
      timeoutMs: 1500,
      asOf: opts.asOf,
      timezone: opts.timezone,
    });
    perCondition.push({
      path: leaf.path,
      label: `${leaf.node.field.kind}:${'key' in leaf.node.field ? leaf.node.field.key : ''}:${leaf.node.operator}`,
      count: out.count,
    });
  }
  const zero = perCondition.filter((c) => c.count === 0);
  const mostRestrictive =
    zero[0] ?? perCondition.slice().sort((a, b) => a.count - b.count)[0] ?? null;

  let fieldStats: EmptyDiagnostics['fieldStats'] = null;
  const culprit =
    mostRestrictive === null
      ? undefined
      : leaves.find((l) => l.path.join() === mostRestrictive.path.join());
  if (culprit !== undefined && culprit.node.field.kind === 'attribute') {
    const key = culprit.node.field.key;
    // `attributes ? $key` NELZE použít: jediný GIN nad attributes je
    // jsonb_path_ops a ta operátor `?` v indexu nemá, takže by tenhle dotaz
    // šel seq scanem přes celý projekt. Se stropem 1500 ms by u pěti milionů
    // kontaktů nedoběhl a obrazovka „proč je segment prázdný" by mlčela
    // právě v tom případě, kvůli kterému existuje. Zůstává tedy `-> klíč`,
    // které index nevyužije taky, ale běží nad už zúženou množinou projektu
    // a u klíčů, které nikdo nemá, odpoví okamžitě.
    const { rows: stats } = await runReadOnly(
      ctx,
      (tx) =>
        tx.execute<{ filled: string; total: string }>(sql`
        SELECT count(*) FILTER (WHERE attributes -> ${key}::text IS NOT NULL) AS filled,
               count(*) AS total
          FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL`),
      { timeoutMs: 1500 },
    );
    const { rows: top } = await runReadOnly(
      ctx,
      (tx) =>
        tx.execute<{ value: string; count: number }>(sql`
        SELECT attributes ->> ${key}::text AS value, count(*)::int AS count
          FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL
           AND attributes -> ${key}::text IS NOT NULL
         GROUP BY 1 ORDER BY count DESC LIMIT 5`),
      { timeoutMs: 1500 },
    );
    fieldStats = {
      key,
      filled: Number(stats[0]?.filled ?? 0),
      total: Number(stats[0]?.total ?? 0),
      topValues: top,
    };
  }
  return { perCondition, mostRestrictive, fieldStats };
}
