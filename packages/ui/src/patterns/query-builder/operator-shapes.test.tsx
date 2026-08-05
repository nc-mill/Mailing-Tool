import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QueryBuilder } from './query-builder';
import { OPERATOR_SHAPES } from './types';
import type { FieldDefinition, FieldValueType, OperatorValueShape, SegmentAst } from './types';

/**
 * Popisky jsou tu vlastní, ne importované z `query-builder.test.tsx`.
 * Import testového souboru z jiného testového souboru by celou jeho sadu
 * zaregistroval podruhé a počty testů by přestaly sedět.
 */
const labels = {
  addRule: 'Přidat podmínku',
  addGroup: 'Přidat skupinu',
  removeRule: 'Odebrat podmínku',
  removeGroup: 'Odebrat skupinu',
  chooseField: 'Vyberte údaj',
  chooseOperator: 'Vyberte vztah',
  value: 'Hodnota',
  valueFrom: 'Od',
  valueTo: 'Do',
  valueList: 'Seznam hodnot',
  addValue: 'Přidat hodnotu',
  removeValue: (item: string) => `Odebrat hodnotu ${item}`,
  listLimit: (max: number) => `Do seznamu se vejde nejvýš ${max} hodnot.`,
  unknownValue: (value: string) => `Smazaná položka (${value})`,
  noOptions: 'Není z čeho vybírat.',
  rangeOrder: 'První hodnota musí být menší nebo rovna druhé.',
  showJson: 'Zobrazit podklad',
  depthLimit: 'Hlouběji už zanořovat nejde, stačí to na každý segment, který jsme viděli.',
  childLimit: 'Do jedné skupiny se vejde nejvýš 50 podmínek.',
  negationHint: 'Vybíráme kontakty, které tuhle skupinu podmínek nesplňují.',
  notNullHint: 'Kontakty s prázdnou hodnotou sem nespadnou. Chcete je přidat?',
  addEmptyCondition: 'Přidat podmínku „je prázdné"',
  all: 'všechny',
  atLeastOne: 'alespoň jednu',
  is: 'splňuje',
  isNot: 'nesplňuje',
};

/** Typ hodnoty, na kterém se daný operátor v matici 4.11.2 vyskytuje. */
const VALUE_TYPE: Record<string, FieldValueType> = {
  gt: 'number',
  gte: 'number',
  lt: 'number',
  lte: 'number',
  on: 'date',
  before: 'date',
  after: 'date',
  between: 'date',
};

function fieldFor(operator: string, shape: OperatorValueShape): FieldDefinition {
  return {
    id: 'attribute:probe',
    label: 'Zkušební pole',
    group: 'Údaje kontaktu',
    ref: { kind: 'attribute', key: 'probe' },
    valueType: VALUE_TYPE[operator] ?? 'text',
    operators: [
      {
        id: operator,
        label: operator,
        shape,
        ...(shape === 'integer' ? { min: 0, max: 3650 } : {}),
        ...(shape === 'list' ? { minItems: 1, maxItems: 1000 } : {}),
      },
    ],
  };
}

function astFor(operator: string, shape: OperatorValueShape): SegmentAst {
  const field = { kind: 'attribute' as const, key: 'probe' };
  const base = { type: 'condition' as const, field, operator };
  const condition =
    shape === 'none'
      ? base
      : shape === 'list'
        ? { ...base, values: ['Praha'] }
        : shape === 'range'
          ? { ...base, values: [null, null] }
          : { ...base, value: null };
  return { version: 1, root: { type: 'group', op: 'and', children: [condition] } };
}

describe('všech 40 operátorů matice 4.11.2 jde zadat', () => {
  for (const [shape, operators] of Object.entries(OPERATOR_SHAPES) as Array<
    [OperatorValueShape, readonly string[]]
  >) {
    for (const operator of operators) {
      it(`${operator} (${shape}) nabídne správný ovládací prvek`, () => {
        const { unmount } = render(
          <QueryBuilder
            value={astFor(operator, shape)}
            onChange={() => {}}
            fields={[fieldFor(operator, shape)]}
            labels={labels}
          />,
        );

        const inputs = screen.queryAllByTestId('condition-value');

        if (shape === 'none') {
          // Šestnáct operátorů hodnotu nepřijímá. Vstupní pole u nich
          // vede uživatele k tomu, aby vyrobil segment, který server odmítne.
          expect(inputs, `${operator} nesmí nabídnout pole na hodnotu`).toHaveLength(0);
        } else if (shape === 'range') {
          expect(inputs, `${operator} potřebuje dvě pole`).toHaveLength(2);
          expect(screen.getByLabelText(labels.valueFrom)).toBeVisible();
          expect(screen.getByLabelText(labels.valueTo)).toBeVisible();
        } else if (shape === 'list') {
          expect(screen.getByTestId('condition-value-list')).toBeVisible();
          expect(screen.getByRole('button', { name: labels.addValue })).toBeVisible();
        } else {
          expect(inputs, `${operator} potřebuje jedno pole`).toHaveLength(1);
        }

        if (shape === 'integer') {
          expect(inputs[0]).toHaveAttribute('type', 'number');
          expect(inputs[0]).toHaveAttribute('min', '0');
          expect(inputs[0]).toHaveAttribute('max', '3650');
        }
        if (shape === 'scalar') {
          const expected =
            VALUE_TYPE[operator] === 'number'
              ? 'number'
              : VALUE_TYPE[operator] === 'date'
                ? 'date'
                : 'text';
          expect(inputs[0], `${operator} má mít vstup typu ${expected}`).toHaveAttribute(
            'type',
            expected,
          );
        }

        unmount();
      });
    }
  }
});
