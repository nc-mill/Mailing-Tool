import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { QueryBuilder } from './query-builder';
import type { FieldDefinition, SegmentAst } from './types';

export const fields: FieldDefinition[] = [
  {
    id: 'attribute:city',
    label: 'Město',
    group: 'Údaje kontaktu',
    ref: { kind: 'attribute', key: 'city' },
    valueType: 'text',
    operators: [
      { id: 'eq', label: 'je', shape: 'scalar' },
      { id: 'neq', label: 'není', shape: 'scalar', negating: true },
      { id: 'in', label: 'je jedna z', shape: 'list', minItems: 1, maxItems: 1000 },
      { id: 'is_empty', label: 'je prázdné', shape: 'none' },
    ],
  },
  {
    id: 'engagement:opened',
    label: 'Otevřel kampaň',
    group: 'Chování',
    ref: { kind: 'engagement', metric: 'opened', scope: { since_days: 90 } },
    valueType: 'number',
    operators: [
      { id: 'did', label: 'ano', shape: 'none' },
      { id: 'count_gte', label: 'aspoň tolikrát', shape: 'integer', min: 0, max: 1_000_000 },
    ],
  },
];

export const empty: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', not: false, children: [] },
};

export const labels = {
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

/** Věta se skládá v katalogu, komponenta jen dosadí sloty. */
function renderSentenceNormal(slots: { polarity: React.ReactNode; quantifier: React.ReactNode }) {
  return (
    <>
      Kontakt {slots.polarity} {slots.quantifier} z těchto podmínek:
    </>
  );
}

function renderSentenceReversed(slots: { polarity: React.ReactNode; quantifier: React.ReactNode }) {
  return (
    <>
      Podmínky {slots.quantifier} kontakt {slots.polarity}:
    </>
  );
}

/** Komponenta je řízená, takže test drží strom stejně jako obrazovka segmentu. */
export function Controlled({
  initial = empty,
  ...rest
}: { initial?: SegmentAst } & Partial<React.ComponentProps<typeof QueryBuilder>>) {
  const [value, setValue] = useState<SegmentAst>(initial);
  return (
    <QueryBuilder
      value={value}
      onChange={setValue}
      fields={fields}
      labels={labels}
      renderGroupSentence={renderSentenceNormal}
      {...rest}
    />
  );
}

describe('QueryBuilder', () => {
  it('nikde nezobrazuje slova AND, OR, NOT ani operátor', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Přidat podmínku' }));

    const text = document.body.textContent as string;
    expect(text).not.toMatch(/\bAND\b/);
    expect(text).not.toMatch(/\bOR\b/);
    expect(text).not.toMatch(/\bNOT\b/);
    expect(text.toLowerCase()).not.toContain('operátor');
  });

  it('pořadí ovládacích prvků určuje věta z katalogu, ne komponenta', () => {
    const normal = render(<Controlled />);
    const normalOrder = Array.from(normal.container.querySelectorAll('[data-slot]')).map((node) =>
      node.getAttribute('data-slot'),
    );
    expect(normalOrder).toEqual(['polarity', 'quantifier']);
    normal.unmount();

    const reversed = render(<Controlled renderGroupSentence={renderSentenceReversed} />);
    const reversedOrder = Array.from(reversed.container.querySelectorAll('[data-slot]')).map(
      (node) => node.getAttribute('data-slot'),
    );
    expect(reversedOrder).toEqual(['quantifier', 'polarity']);
  });

  it('negaci jde zapnout a zobrazí vysvětlující řádek', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.selectOptions(screen.getByLabelText('splňuje'), 'not');
    expect(screen.getByText(labels.negationHint)).toBeVisible();
  });

  it('podmínku jde přidat i odebrat výhradně z klávesnice', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getAllByLabelText('Vyberte údaj')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Odebrat podmínku' }));
    expect(screen.queryByLabelText('Vyberte údaj')).toBeNull();
  });

  it('pole jsou ve výběru rozdělená do skupin', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Přidat podmínku' }));
    const select = screen.getByLabelText('Vyberte údaj');
    expect(within(select).getByRole('group', { name: 'Údaje kontaktu' })).toBeInTheDocument();
    expect(within(select).getByRole('group', { name: 'Chování' })).toBeInTheDocument();
  });

  it('negující operátor nabídne doplnění podmínky na prázdnou hodnotu', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Přidat podmínku' }));
    await user.selectOptions(screen.getByLabelText('Vyberte údaj'), 'attribute:city');
    await user.selectOptions(screen.getByLabelText('Vyberte vztah'), 'neq');
    expect(screen.getByText(labels.notNullHint)).toBeVisible();
    expect(screen.getByRole('button', { name: labels.addEmptyCondition })).toBeVisible();
  });

  it('v páté úrovni schová tlačítko na skupinu a vysvětlí proč', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    for (let level = 0; level < 4; level += 1) {
      // Nejhlubší skupina je v pořadí dokumentu první: tlačítka rodiče
      // se vykreslují až za jeho potomky.
      const buttons = screen.getAllByRole('button', { name: 'Přidat skupinu' });
      await user.click(buttons[0]!);
    }
    expect(screen.getAllByRole('group')).toHaveLength(5);
    expect(screen.getByText(labels.depthLimit)).toBeVisible();
  });

  it('umí zobrazit podkladový JSON a je to tvar ze specifikace', async () => {
    const user = userEvent.setup();
    render(<Controlled showJsonToggle />);
    expect(screen.queryByRole('code')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Zobrazit podklad' }));
    const code = screen.getByRole('code');
    expect(code).toHaveTextContent('"version": 1');
    expect(code).toHaveTextContent('"type": "group"');
  });

  it('vykreslí sto podmínek rozložených do stromu (kritérium 47)', () => {
    const condition = {
      type: 'condition' as const,
      field: { kind: 'attribute' as const, key: 'city' },
      operator: 'eq',
      value: 'Brno',
    };
    const initial: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: Array.from({ length: 4 }, () => ({
          type: 'group' as const,
          op: 'and' as const,
          children: Array.from({ length: 25 }, () => condition),
        })),
      },
    };
    render(<Controlled initial={initial} />);
    expect(screen.getAllByTestId('condition-row')).toHaveLength(100);
  });

  it('ohlásí strom po každé úpravě, ne stav před ní', async () => {
    const user = userEvent.setup();
    const seen: SegmentAst[] = [];
    function Spy() {
      const [value, setValue] = useState<SegmentAst>(empty);
      return (
        <QueryBuilder
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
          fields={fields}
          labels={labels}
          renderGroupSentence={renderSentenceNormal}
        />
      );
    }
    render(<Spy />);
    await user.click(screen.getByRole('button', { name: 'Přidat podmínku' }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.root.children).toHaveLength(1);
  });
});
