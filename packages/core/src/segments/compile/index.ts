import type { ConditionNode, GroupNode, Node, SegmentAst } from '../ast';
import {
  assertOperatorAllowed,
  assertValueMatchesClass,
  assertValueShape,
  contactFieldClass,
} from '../operators';
import type { FieldClass } from '../operators';
import { assertSqlWithinLimit } from '../limits';
import { ParamBag } from './params';
import { assertAlias } from './columns';
import { compileContactCondition } from './contact';
import { compileAttributeCondition } from './attribute';
import {
  compileConsentCondition,
  compileListCondition,
  compileSuppressionCondition,
  compileTagCondition,
} from './tag-list-consent';
import {
  compileEngagementCondition,
  compileEventCondition,
  type CompiledPredicate,
  type SegmentWarning,
} from './engagement-event';
import { compileSegmentRefCondition, resetChildAlias } from './segment-ref';

export type CompileOptions = {
  alias: string;
  paramOffset: number;
  workspaceId: string;
  asOf: Date;
  timezone: string;
  /** Třída každého vlastního pole, načtená z contact_fields. Vrstva 3 už proběhla. */
  fieldClasses: Record<string, FieldClass>;
  /** Druh každého odkazovaného segmentu a jeho AST, když je dynamický. */
  segmentKinds: Record<string, { kind: 'static' | 'dynamic'; ast?: SegmentAst }>;
};

export type CompileResult = { sql: string; params: unknown[]; warnings: SegmentWarning[] };

function fieldClassOf(node: ConditionNode, opts: CompileOptions): FieldClass {
  switch (node.field.kind) {
    case 'contact':
      return contactFieldClass(node.field.key);
    case 'attribute': {
      const cls = opts.fieldClasses[node.field.key];
      if (cls === undefined) throw new Error(`field class for ${node.field.key} was not resolved`);
      return cls;
    }
    case 'tag':
      return 'tag';
    case 'list':
      return 'list';
    case 'consent':
      return 'consent';
    case 'suppression':
      return 'suppression';
    case 'engagement':
      return 'engagement';
    case 'event':
      return 'event';
    case 'segment':
      return 'segment';
  }
}

function compileCondition(
  node: ConditionNode,
  bag: ParamBag,
  opts: CompileOptions,
  negated: boolean,
): CompiledPredicate {
  const cls = fieldClassOf(node, opts);
  assertOperatorAllowed(cls, node.operator);
  assertValueShape(node.operator, node, cls);
  assertValueMatchesClass(cls, node.operator, node);

  switch (node.field.kind) {
    case 'contact':
      return {
        sql: compileContactCondition(opts.alias, node.field, node.operator, node, bag),
        warnings: [],
      };
    case 'attribute':
      return {
        sql: compileAttributeCondition(
          opts.alias,
          node.field.key,
          cls,
          node.operator,
          node,
          bag,
          // Pod lichým počtem negací musí být i totální JSONB containment
          // tříhodnotový, jinak by `NOT` nad chybějícím klíčem vyšlo `true`.
          { unknownAware: negated },
        ),
        warnings: [],
      };
    case 'tag':
      return {
        sql: compileTagCondition(opts.alias, node.operator, (node.values ?? []).map(String), bag),
        warnings: [],
      };
    case 'list':
      return {
        sql: compileListCondition(opts.alias, node.field.list_id, node.operator, bag),
        warnings: [],
      };
    case 'consent':
      return {
        sql: compileConsentCondition(opts.alias, node.field.purpose, node.operator, bag),
        warnings: [],
      };
    case 'suppression':
      return { sql: compileSuppressionCondition(opts.alias, node.operator), warnings: [] };
    case 'engagement':
      return compileEngagementCondition(opts.alias, node.field, node.operator, node, bag);
    case 'event':
      return compileEventCondition(opts.alias, node.field, node.operator, node, bag);
    case 'segment': {
      const segmentId = node.field.segment_id;
      const target = opts.segmentKinds[segmentId];
      if (target === undefined) throw new Error(`segment ${segmentId} was not resolved`);
      const sql = compileSegmentRefCondition(
        opts.alias,
        segmentId,
        node.operator,
        target,
        bag,
        (childAlias) => {
          const childAst = target.ast;
          if (childAst === undefined) throw new Error('dynamic segment reference without ast');
          return compileNode(childAst.root, bag, { ...opts, alias: childAlias }, negated).sql;
        },
      );
      return { sql, warnings: [] };
    }
  }
}

/**
 * Tříhodnotová logika. Listový predikát smí vrátit SQL `NULL`, tedy „neznámo",
 * a skládání ho NIKDY nesráží na `false`.
 *
 * ODCHYLKA OD PLÁNU, vynucená tvrdým požadavkem zadání. Plán obaloval každý
 * list do `coalesce(pred, false)`. Tím se ale ztratí právě ta informace, kvůli
 * které tříhodnotová logika existuje: `NOT coalesce(NULL, false)` je `NOT false`,
 * tedy `true`, takže segment „NEMÁ vyplněné město Praha" by vrátil i lidi,
 * u kterých město vůbec neznáme. Bez coalesce zůstane `NOT NULL` neznámem
 * a `WHERE` v obálce ho vyřadí, což je správná odpověď na otázku, na kterou
 * data neodpovídají.
 *
 * Praktický důsledek pro totální predikáty (`EXISTS`, JSONB `@>`) řeší příznak
 * `negated`, který se předává až k listu, viz `compileAttributeCondition`.
 */
function compileNode(
  node: Node,
  bag: ParamBag,
  opts: CompileOptions,
  negated: boolean,
): CompiledPredicate {
  if (node.type === 'condition') return compileCondition(node, bag, opts, negated);

  const group: GroupNode = node;
  const childNegated = group.not === true ? !negated : negated;
  const parts: string[] = [];
  const warnings: SegmentWarning[] = [];
  for (const child of group.children) {
    const out = compileNode(child, bag, opts, childNegated);
    parts.push(out.sql);
    warnings.push(...out.warnings);
  }
  const joined = `(${parts.join(group.op === 'and' ? ' AND ' : ' OR ')})`;
  return { sql: group.not === true ? `(NOT ${joined})` : joined, warnings };
}

/** Zkompiluje AST na predikát bez obálky. Obálku přidává `repo.ts`. */
export function compileSegmentSql(ast: SegmentAst, opts: CompileOptions): CompileResult {
  assertAlias(opts.alias);
  resetChildAlias();
  const bag = new ParamBag(opts.paramOffset);
  bag.add(opts.workspaceId, 'uuid');
  bag.add(opts.asOf.toISOString(), 'timestamptz');
  bag.add(opts.timezone);
  const out = compileNode(ast.root, bag, opts, false);
  assertSqlWithinLimit(out.sql);
  return { sql: out.sql, params: bag.values, warnings: [...new Set(out.warnings)] };
}
