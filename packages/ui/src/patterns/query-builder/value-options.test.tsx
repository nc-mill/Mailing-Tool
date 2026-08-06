import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { QueryBuilder } from './query-builder';
import { fieldRefKey } from './ref-key';
import type { FieldDefinition, SegmentAst } from './types';
import { labels } from './query-builder.test';

const NEWSLETTER = '019fc79f-7b3e-751c-a316-38118b61ec55';
const PRAHA = '019fc79f-7b3d-7c61-aa73-dee3763a23f0';

const tagField = (options: Array<{ value: string; label: string }>): FieldDefinition => ({
  id: 'tag',
  label: 'Má štítek',
  group: 'Štítky',
  ref: { kind: 'tag' },
  valueType: 'enum',
  options,
  operators: [{ id: 'has_any', label: 'má aspoň jeden z', shape: 'list', maxItems: 1000 }],
});

const tagCondition = (values: string[]): SegmentAst => ({
  version: 1,
  root: {
    type: 'group',
    op: 'and',
    children: [{ type: 'condition', field: { kind: 'tag' }, operator: 'has_any', values }],
  },
});

function Controlled({
  fields,
  initial,
}: {
  fields: FieldDefinition[];
  initial: SegmentAst;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  return <QueryBuilder fields={fields} value={value} onChange={setValue} labels={labels} />;
}

describe('hodnota z nabídky', () => {
  it('uloží identifikátor, i když uživatel klikl na název', async () => {
    // Tohle je celý ten nahlášený případ: uživatel chce štítek Newsletter
    // a do podmínky musí doputovat uuid, ne slovo „Newsletter".
    const user = userEvent.setup();
    let latest: SegmentAst | null = null;
    function Spy() {
      const [value, setValue] = useState(tagCondition([]));
      latest = value;
      return (
        <QueryBuilder
          fields={[tagField([{ value: NEWSLETTER, label: 'Newsletter' }])]}
          value={value}
          onChange={setValue}
          labels={labels}
        />
      );
    }
    render(<Spy />);

    await user.selectOptions(screen.getByLabelText(labels.valueList), NEWSLETTER);

    const condition = (latest as unknown as SegmentAst).root.children[0] as { values?: unknown[] };
    expect(condition.values).toEqual([NEWSLETTER]);
    // A na obrazovce zůstane název, ne uuid.
    expect(screen.getByText('Newsletter')).toBeVisible();
    expect(screen.queryByText(NEWSLETTER)).toBeNull();
  });

  it('u uložené podmínky ukáže název štítku místo uuid', () => {
    render(
      <Controlled
        fields={[tagField([{ value: PRAHA, label: 'Praha' }])]}
        initial={tagCondition([PRAHA])}
      />,
    );
    expect(screen.getByText('Praha')).toBeVisible();
    expect(screen.queryByText(PRAHA)).toBeNull();
  });

  it('smazaný štítek přizná slovy, syrové uuid neukáže jako název', () => {
    render(<Controlled fields={[tagField([])]} initial={tagCondition([PRAHA])} />);
    expect(screen.getByText(labels.unknownValue(PRAHA))).toBeVisible();
  });

  it('prázdnou nabídku vysvětlí, nenechá mrtvý ovládací prvek', () => {
    render(<Controlled fields={[tagField([])]} initial={tagCondition([])} />);
    expect(screen.getByText(labels.noOptions)).toBeVisible();
    expect(screen.queryByLabelText(labels.valueList)).toBeNull();
  });

  it('bez nabídky zůstává volný text', async () => {
    const user = userEvent.setup();
    const free: FieldDefinition = {
      id: 'attribute.city',
      label: 'Město',
      group: 'Vlastní pole',
      ref: { kind: 'attribute', key: 'city' },
      valueType: 'text',
      operators: [{ id: 'in', label: 'je jedno z', shape: 'list', maxItems: 1000 }],
    };
    render(
      <Controlled
        fields={[free]}
        initial={{
          version: 1,
          root: {
            type: 'group',
            op: 'and',
            children: [
              {
                type: 'condition',
                field: { kind: 'attribute', key: 'city' },
                operator: 'in',
                values: [],
              },
            ],
          },
        }}
      />,
    );
    await user.type(screen.getByLabelText(labels.valueList), 'Brno');
    await user.click(screen.getByRole('button', { name: labels.addValue }));
    expect(screen.getByText('Brno')).toBeVisible();
  });
});

describe('párování pole s odkazem v AST', () => {
  /**
   * Definice segmentu leží v `jsonb`, kde Postgres klíče přerovná. Porovnání
   * dvou `JSON.stringify` se proto u uloženého segmentu nikdy netrefilo
   * a výběr pole u každé podmínky zůstal prázdný.
   */
  it('najde pole i pro odkaz s přerovnanými klíči', () => {
    const field: FieldDefinition = {
      id: 'contact.status',
      label: 'Stav kontaktu',
      group: 'O člověku',
      ref: { kind: 'contact', key: 'status' },
      valueType: 'text',
      operators: [{ id: 'eq', label: 'je', shape: 'scalar' }],
    };
    render(
      <Controlled
        fields={[field]}
        initial={{
          version: 1,
          root: {
            type: 'group',
            op: 'and',
            children: [
              {
                type: 'condition',
                // Pořadí klíčů z databáze: nejdřív kratší, pak delší.
                field: JSON.parse('{"key":"status","kind":"contact"}') as {
                  kind: 'contact';
                  key: string;
                },
                operator: 'eq',
                value: 'active',
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByLabelText(labels.chooseField)).toHaveValue('contact.status');
    expect(screen.getByLabelText(labels.chooseOperator)).toHaveValue('eq');
    expect(screen.getByLabelText(labels.value)).toHaveValue('active');
  });

  it('otisk odkazu nezávisí na pořadí klíčů ani na zanoření', () => {
    expect(
      fieldRefKey({ kind: 'engagement', metric: 'sent', scope: { last_n_campaigns: 5 } }),
    ).toBe(fieldRefKey({ scope: { last_n_campaigns: 5 }, metric: 'sent', kind: 'engagement' }));
    expect(fieldRefKey({ kind: 'tag' })).not.toBe(fieldRefKey({ kind: 'list', list_id: 'a' }));
  });
});
