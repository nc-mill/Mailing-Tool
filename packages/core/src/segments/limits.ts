import type { GroupNode, Node, SegmentAst } from './ast';
import { tooMany } from './errors';

export const SEGMENT_LIMITS = {
  maxConditions: 100,
  maxDepth: 5,
  maxChildren: 50,
  maxEngagement: 5,
  maxEvent: 3,
  maxSegmentNesting: 2,
  maxInItems: 1000,
  maxSqlBytes: 65_536,
  maxDefinitionBytes: 262_144,
} as const;

type Counts = { conditions: number; engagement: number; event: number };

function walk(node: Node, depth: number, counts: Counts): void {
  if (node.type === 'condition') {
    // Podmínka je list, ne úroveň vnoření, a do hloubky se NEPOČÍTÁ. Kdyby se
    // počítala, neunesl by server ani hloubku 4: strom s pěti úrovněmi skupin
    // má listy na šesté a K2 by neměla komu poslat to, co umí sestavit.
    counts.conditions += 1;
    if (node.field.kind === 'engagement') counts.engagement += 1;
    if (node.field.kind === 'event') counts.event += 1;
    return;
  }
  const group: GroupNode = node;
  if (depth > SEGMENT_LIMITS.maxDepth) {
    tooMany('segment_too_deep', { limit: SEGMENT_LIMITS.maxDepth, got: depth });
  }
  if (group.children.length > SEGMENT_LIMITS.maxChildren) {
    tooMany('segment_too_complex', {
      limit: SEGMENT_LIMITS.maxChildren,
      got: group.children.length,
      reason: 'children',
    });
  }
  for (const child of group.children) walk(child, depth + 1, counts);
}

/**
 * Hloubka se počítá od kořene jako 1, takže kořen plus čtyři vnořené skupiny je
 * hloubka 5 a projde. Šestá úroveň spadne. Je to přímý překlad tvrdého požadavku
 * na komponentu K2 do serverové vrstvy: kdyby server hloubku 5 neunesl, neměla
 * by ji komponenta komu poslat.
 */
export function assertWithinLimits(ast: SegmentAst): void {
  const bytes = Buffer.byteLength(JSON.stringify(ast), 'utf8');
  if (bytes > SEGMENT_LIMITS.maxDefinitionBytes) {
    tooMany('segment_definition_too_large', {
      limit: SEGMENT_LIMITS.maxDefinitionBytes,
      got: bytes,
    });
  }
  const counts: Counts = { conditions: 0, engagement: 0, event: 0 };
  walk(ast.root, 1, counts);
  if (counts.conditions > SEGMENT_LIMITS.maxConditions) {
    tooMany('segment_too_complex', {
      limit: SEGMENT_LIMITS.maxConditions,
      got: counts.conditions,
      reason: 'conditions',
    });
  }
  if (counts.engagement > SEGMENT_LIMITS.maxEngagement) {
    tooMany('segment_too_many_engagement', {
      limit: SEGMENT_LIMITS.maxEngagement,
      got: counts.engagement,
    });
  }
  if (counts.event > SEGMENT_LIMITS.maxEvent) {
    tooMany('segment_too_many_event', { limit: SEGMENT_LIMITS.maxEvent, got: counts.event });
  }
}

export function assertSqlWithinLimit(sql: string): void {
  const bytes = Buffer.byteLength(sql, 'utf8');
  if (bytes > SEGMENT_LIMITS.maxSqlBytes) {
    tooMany('segment_too_complex', {
      limit: SEGMENT_LIMITS.maxSqlBytes,
      got: bytes,
      reason: 'sql_length',
    });
  }
}
