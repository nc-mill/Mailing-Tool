import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OPERATOR_SHAPES } from '@mlain/ui/patterns/query-builder';
import { FIELD_CLASS_OPERATORS, OPERATORS } from '@mlain/core/segments';
import { describe, expect, it, vi } from 'vitest';
import { QueryBuilder } from '@mlain/ui/patterns/query-builder';
import type { FieldDefinition, SegmentAst } from '@mlain/ui/patterns/query-builder';
import { builderLabels } from '../../src/features/segments/labels';
import { catalogTranslate, renderIntl } from '../helpers/intl';

const labels = builderLabels(catalogTranslate('cs', 'segments'));

/** Pole pro každou třídu matice. `ref` je DOSLOVA tvar, který jde do AST. */
function allFields(): FieldDefinition[] {
  const shapeOf = (operator: string) =>
    (Object.entries(OPERATOR_SHAPES).find(([, list]) => list.includes(operator))?.[0] ??
      'scalar') as 'none' | 'scalar' | 'list' | 'range' | 'integer';
  return [
    {
      id: 'status',
      label: 'Stav kontaktu',
      group: 'O člověku',
      ref: { kind: 'contact', key: 'status' },
      valueType: 'enum',
      operators: FIELD_CLASS_OPERATORS.enum.map((id) => ({ id, label: id, shape: shapeOf(id) })),
    },
    {
      id: 'tag',
      label: 'Má štítek',
      group: 'Štítky',
      ref: { kind: 'tag' },
      valueType: 'text',
      operators: FIELD_CLASS_OPERATORS.tag.map((id) => ({ id, label: id, shape: shapeOf(id) })),
    },
  ];
}

function nested(depth: number): SegmentAst['root'] {
  let node: SegmentAst['root'] = {
    type: 'group',
    op: 'and',
    children: [
      {
        type: 'condition',
        field: { kind: 'contact', key: 'status' },
        operator: 'eq',
        value: 'active',
      },
    ],
  };
  for (let i = 1; i < depth; i += 1) node = { type: 'group', op: 'and', children: [node] };
  return node;
}

describe('K2 query builder conformance', () => {
  it('renders a tree nested five levels deep', () => {
    renderIntl(
      <QueryBuilder
        value={{ version: 1, root: nested(5) }}
        onChange={vi.fn()}
        fields={allFields()}
        labels={labels}
      />,
    );
    expect(screen.getAllByRole('group').length).toBeGreaterThanOrEqual(5);
  });

  it('renders fifty children in one group', () => {
    const children = Array.from({ length: 50 }, () => ({
      type: 'condition' as const,
      field: { kind: 'contact' as const, key: 'status' },
      operator: 'eq',
      value: 'active',
    }));
    renderIntl(
      <QueryBuilder
        value={{ version: 1, root: { type: 'group', op: 'and', children } }}
        onChange={vi.fn()}
        fields={allFields()}
        labels={labels}
      />,
    );
    expect(screen.getAllByLabelText(labels.chooseOperator)).toHaveLength(50);
  });

  it('exposes a negation control on every group, including nested ones', () => {
    renderIntl(
      <QueryBuilder
        value={{ version: 1, root: nested(3) }}
        onChange={vi.fn()}
        fields={allFields()}
        labels={labels}
      />,
    );
    expect(
      screen.getAllByLabelText(new RegExp(`${labels.is}|${labels.isNot}`, 'i')).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('offers only operators that fit the field class', () => {
    renderIntl(
      <QueryBuilder
        value={{ version: 1, root: nested(1) }}
        onChange={vi.fn()}
        fields={allFields()}
        labels={labels}
      />,
    );
    const select = screen.getAllByLabelText(labels.chooseOperator)[0]!;
    const options = within(select)
      .getAllByRole('option')
      .map((node) => node.getAttribute('value'));
    // Prázdná úvodní volba („vyberte") není operátor a do matice nepatří.
    const offered = options.filter((option) => option !== null && option !== '');
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((option) => FIELD_CLASS_OPERATORS.enum.includes(option as never))).toBe(
      true,
    );
  });

  it('can show the underlying json without making it the default', async () => {
    renderIntl(
      <QueryBuilder
        value={{ version: 1, root: nested(1) }}
        onChange={vi.fn()}
        fields={allFields()}
        labels={labels}
        showJsonToggle
      />,
    );
    expect(screen.queryByText(/"version"/)).toBeNull();
    // Jméno tlačítka se bere z KATALOGU přes labels.showJson, ne natvrdo.
    await userEvent.click(screen.getByRole('button', { name: labels.showJson }));
    expect(screen.getByText(/"version"/)).toBeInTheDocument();
  });

  it('agrees with the component on all forty operators and their value shapes', () => {
    // Smlouva mezi tímhle plánem a P05, čtená z OBOU stran. Když jedna strana
    // operátor přidá nebo přesune do jiného tvaru, spadne to tady, ne až na
    // obrazovce vstupem, který server odmítne.
    const shaped = Object.values(OPERATOR_SHAPES).flat();
    expect(shaped).toHaveLength(40);
    expect(new Set(shaped).size).toBe(40);
    expect([...shaped].sort()).toEqual([...OPERATORS].sort());
    expect(
      Object.fromEntries(
        Object.entries(OPERATOR_SHAPES).map(([shape, list]) => [shape, list.length]),
      ),
    ).toEqual({ none: 16, scalar: 13, list: 5, range: 1, integer: 5 });
  });

  it('covers all forty operators across the field classes of this plan', () => {
    const seen = new Set<string>();
    for (const operators of Object.values(FIELD_CLASS_OPERATORS)) {
      for (const operator of operators) seen.add(operator);
    }
    expect(seen.size).toBe(40);
  });
});
