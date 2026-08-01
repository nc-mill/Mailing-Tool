'use client';

import { QueryBuilder, MAX_CHILDREN, MAX_DEPTH } from '@mlain/ui/patterns/query-builder';
import type { FieldDefinition, SegmentAst } from '@mlain/ui/patterns/query-builder';
import { useTranslations } from 'next-intl';
import { GroupSentence } from './group-sentence';
import { builderLabels } from './labels';
import { isNegating, NullHint } from './null-hint';

/** Nejvýš sto podmínek na segment, od osmdesáti se počítadlo ukazuje. */
export const MAX_CONDITIONS = 100;
export const COUNTER_FROM = 80;
/** Od třetí úrovně se nabízí rozdělení: hlouběji už segment nikdo nepřečte. */
export const SPLIT_FROM_DEPTH = 3;

type Node = SegmentAst['root'] | { type: 'condition'; field: unknown; operator: string; value?: unknown };

/**
 * Hloubka se počítá po SKUPINÁCH, ne po uzlech. Podmínka není další úroveň
 * zanoření: kdyby se počítala, hlásil by builder mez o jedna dřív, než ji
 * kompilátor doopravdy má, a uživatel by nemohl postavit segment, který
 * server bez problému přijme.
 */
function walk(node: unknown, depth = 1): { conditions: number; depth: number; operators: string[] } {
  const typed = node as { type?: string; children?: unknown[]; operator?: string };
  if (typed.type === 'condition') {
    return { conditions: 1, depth: depth - 1, operators: [typed.operator ?? ''] };
  }
  const children = (typed.children ?? []).map((child) => walk(child, depth + 1));
  return {
    conditions: children.reduce((sum, child) => sum + child.conditions, 0),
    depth: children.reduce((max, child) => Math.max(max, child.depth), depth),
    operators: children.flatMap((child) => child.operators),
  };
}

/** Dvě podmínky na TÉMŽE poli s rovností v „všechny podmínky" nemůže splnit nikdo. */
function contradiction(node: unknown): [string, string] | null {
  const typed = node as { type?: string; op?: string; children?: unknown[] };
  if (typed.type !== 'group') return null;
  if (typed.op === 'and') {
    const equalities = (typed.children ?? []).filter((child) => {
      const c = child as { type?: string; operator?: string };
      return c.type === 'condition' && c.operator === 'eq';
    }) as { field: unknown; value?: unknown }[];
    for (let i = 0; i < equalities.length; i += 1) {
      for (let j = i + 1; j < equalities.length; j += 1) {
        const a = equalities[i];
        const b = equalities[j];
        if (
          a &&
          b &&
          JSON.stringify(a.field) === JSON.stringify(b.field) &&
          JSON.stringify(a.value) !== JSON.stringify(b.value)
        ) {
          return [String(a.value), String(b.value)];
        }
      }
    }
  }
  for (const child of typed.children ?? []) {
    const found = contradiction(child);
    if (found) return found;
  }
  return null;
}

const EMPTY_AST: SegmentAst = { version: 1, root: { type: 'group', op: 'and', children: [] } };

/**
 * Builder segmentu nad K2. Komponenta je řízená a tenhle obal jí dodává:
 * větu skupiny jako ICU zprávu, upozornění na prázdné hodnoty, počítadlo
 * podmínek, meze hloubky a pasti, které vypadají jako správný segment.
 */
export function SegmentBuilder({
  value,
  fields = [],
  onChange,
  totalContacts,
  campaignCount,
  footer,
}: {
  value: SegmentAst | undefined;
  fields?: FieldDefinition[];
  onChange: (next: SegmentAst) => void;
  totalContacts?: number;
  campaignCount?: number;
  footer?: React.ReactNode;
}) {
  const t = useTranslations('segments');
  const ast = value ?? EMPTY_AST;
  const stats = walk(ast.root);
  const negating = stats.operators.some((operator) => isNegating(operator));
  const clash = contradiction(ast.root);
  const neverOpened = stats.operators.includes('did_not') || stats.operators.includes('count_lte');

  function addEmptyCondition() {
    // Podmínka na prázdno se přidává do skupiny „alespoň jednu podmínku",
    // ne vedle. Kdyby se přidala do „všechny", segment by se vyprázdnil.
    const first = ast.root.children[0];
    const wrapped = {
      type: 'group' as const,
      op: 'or' as const,
      children: [
        ...(first ? [first] : []),
        {
          type: 'condition' as const,
          field: (first as { field?: unknown } | undefined)?.field ?? { kind: 'contact', key: 'first_name' },
          operator: 'is_empty',
        },
      ],
    };
    onChange({
      version: 1,
      root: { ...ast.root, children: [wrapped, ...ast.root.children.slice(1)] },
    } as SegmentAst);
  }

  return (
    <div className="flex flex-col gap-3">
      {stats.conditions === 0 && totalContacts !== undefined ? (
        // Prázdný segment NENÍ chyba: obsahuje všechny kontakty. Kdyby to
        // svítilo červeně, uživatel by hledal, co udělal špatně.
        <p>{t('count.emptyAll', { count: totalContacts })}</p>
      ) : null}

      {stats.conditions >= COUNTER_FROM ? (
        <p>{t('builder.conditionCounter', { used: stats.conditions, limit: MAX_CONDITIONS })}</p>
      ) : null}

      {stats.depth >= SPLIT_FROM_DEPTH ? (
        <>
          <p>{t('builder.groupNumber', { path: stats.depth })}</p>
          <button type="button">{t('builder.splitSuggestion')}</button>
        </>
      ) : null}

      {stats.depth >= MAX_DEPTH ? <p>{t('builder.noDeeper')}</p> : null}

      {negating ? <NullHint onAddEmptyCondition={addEmptyCondition} /> : null}

      {clash ? <p role="alert">{t('traps.contradiction', { a: clash[0], b: clash[1] })}</p> : null}

      {neverOpened && campaignCount === 0 ? <p>{t('traps.noCampaignsYet')}</p> : null}

      <QueryBuilder
        value={ast}
        fields={fields}
        onChange={onChange}
        labels={builderLabels(t)}
        showJsonToggle
        renderGroupSentence={() => (
          <GroupSentence
            op={ast.root.op}
            not={ast.root.not === true}
            onChange={(next) =>
              onChange({ version: 1, root: { ...ast.root, op: next.op, not: next.not } })
            }
          />
        )}
        {...(footer === undefined ? {} : { footer })}
      />

      {stats.conditions >= MAX_CONDITIONS ? (
        <p>{t('limits.tooComplex', { limit: MAX_CONDITIONS })}</p>
      ) : null}

      <span hidden data-max-children={MAX_CHILDREN} />
    </div>
  );
}
