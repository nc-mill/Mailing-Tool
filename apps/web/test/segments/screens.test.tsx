import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SegmentAst } from '@mlain/ui/patterns/query-builder';
import { SegmentBuilder } from '../../src/features/segments/segment-builder';
import { EmptyDiagnostics } from '../../src/features/segments/empty-diagnostics';
import { CleanupScenario } from '../../src/features/segments/cleanup-scenario';
import { PresetGrid } from '../../src/features/segments/preset-card';
import { AudienceBreakdown } from '../../src/components/segments/audience-breakdown';
import { renderIntl } from '../helpers/intl';

const condition = (operator: string, value: unknown = 'Praha') => ({
  type: 'condition' as const,
  field: { kind: 'attribute' as const, key: 'city' },
  operator,
  value,
});

const astWith = (operator: string): SegmentAst => ({
  version: 1,
  root: { type: 'group', op: 'and', children: [condition(operator)] },
});

const astWithConditions = (count: number): SegmentAst => ({
  version: 1,
  root: {
    type: 'group',
    op: 'and',
    children: Array.from({ length: count }, () => condition('eq')),
  },
});

function astNested(depth: number): SegmentAst {
  let node: SegmentAst['root'] = { type: 'group', op: 'and', children: [condition('eq')] };
  for (let i = 1; i < depth; i += 1) node = { type: 'group', op: 'and', children: [node] };
  return { version: 1, root: node };
}

describe('segment builder', () => {
  it('shows the null hint for every negating operator', () => {
    for (const operator of ['neq', 'not_contains', 'not_in', 'has_none', 'not_in_last_days']) {
      const { unmount } = renderIntl(
        <SegmentBuilder value={astWith(operator)} onChange={vi.fn()} />,
      );
      expect(
        screen.getByText(/kontakty, které pole vůbec nemají, sem nespadnou/i),
        operator,
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('offers a button that adds the is empty condition into an any group', async () => {
    const onChange = vi.fn();
    renderIntl(<SegmentBuilder value={astWith('neq')} onChange={onChange} />);
    await userEvent.click(
      screen.getByRole('button', { name: /přidat i kontakty bez vyplněného pole/i }),
    );
    const next = onChange.mock.lastCall![0] as SegmentAst;
    expect(next.root.children[0]).toMatchObject({ type: 'group', op: 'or' });
    expect(JSON.stringify(next)).toContain('"is_empty"');
  });

  it('counts conditions from eighty and hides the add button at one hundred', () => {
    const { rerender } = renderIntl(
      <SegmentBuilder value={astWithConditions(80)} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/80 ze 100 podmínek/i)).toBeInTheDocument();
    rerender(<SegmentBuilder value={astWithConditions(100)} onChange={vi.fn()} />);
    expect(screen.getByText(/segment už má 100 podmínek/i)).toBeInTheDocument();
  });

  it('explains the depth limit at level five', () => {
    renderIntl(<SegmentBuilder value={astNested(5)} onChange={vi.fn()} />);
    // Hlásí to obal i samotná K2, takže výskytů je víc než jeden. Podstatné je,
    // že se to řekne, a že v páté úrovni už tlačítko na další skupinu není.
    // Hlásí to obal i samotná K2, takže výskytů je víc než jeden. Skrytí
    // tlačítka v NEJHLUBŠÍ skupině vlastní K2 a ověřuje ji vlastní test;
    // ve vyšších úrovních tlačítko zůstat MÁ, jinak by šlo přidat skupinu
    // jen na jednom místě stromu.
    expect(screen.getAllByText(/hlouběji už zanořovat nejde/i).length).toBeGreaterThan(0);
  });

  it('numbers groups and suggests splitting from the third level', () => {
    renderIntl(<SegmentBuilder value={astNested(3)} onChange={vi.fn()} />);
    expect(screen.getByText(/skupina 3/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /nechcete ho rozdělit na dva/i }),
    ).toBeInTheDocument();
  });

  it('warns about two contradicting conditions on the same field in an all group', () => {
    const ast: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [condition('eq', 'Praha'), condition('eq', 'Brno')],
      },
    };
    renderIntl(<SegmentBuilder value={ast} onChange={vi.fn()} />);
    expect(screen.getByText(/nemůže splnit nikdo najednou/i)).toBeInTheDocument();
  });

  it('warns that a project without campaigns matches everyone on never opened', () => {
    const ast: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'engagement', metric: 'opened', scope: {} },
            operator: 'did_not',
          },
        ],
      },
    };
    renderIntl(<SegmentBuilder value={ast} onChange={vi.fn()} campaignCount={0} />);
    expect(screen.getByText(/zatím jste neposlali žádnou kampaň/i)).toBeInTheDocument();
  });

  it('says an empty segment contains everyone, and does not call it an error', () => {
    renderIntl(<SegmentBuilder value={undefined} onChange={vi.fn()} totalContacts={12_480} />);
    expect(screen.getByText(/obsahuje tedy všechny kontakty/i).textContent).toMatch(/12.480/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

const diagnostics = () => ({
  perCondition: [
    { path: [0], label: 'Město je Brno', count: 0 },
    { path: [1], label: 'Stav je aktivní', count: 3412 },
  ],
  mostRestrictive: { path: [0], label: 'Město je Brno', count: 0 },
  fieldStats: {
    key: 'city',
    filled: 340,
    total: 12_480,
    topValues: [
      { value: 'Praha', count: 120 },
      { value: 'brno', count: 44 },
    ],
  },
  caseSuggestion: 'brno',
});

describe('empty result diagnostics', () => {
  it('names the condition that alone returns zero and lists the others', () => {
    renderIntl(<EmptyDiagnostics data={diagnostics()} />);
    expect(screen.getByText(/nejvíc omezuje tahle podmínka/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Město je Brno/).length).toBeGreaterThan(0);
    expect(screen.getByText(/3412/)).toBeInTheDocument();
  });

  it('shows how often the field is filled and its most frequent values', () => {
    renderIntl(<EmptyDiagnostics data={diagnostics()} />);
    expect(screen.getByText(/vyplněné jen 340 kontaktů z 12.480/i)).toBeInTheDocument();
    expect(screen.getByText(/Praha \(120\)/)).toBeInTheDocument();
  });

  it('offers the lowercase value when only the case differs', async () => {
    const onFix = vi.fn();
    renderIntl(<EmptyDiagnostics data={diagnostics()} onUseValue={onFix} />);
    await userEvent.click(screen.getByRole('button', { name: /^použít$/i }));
    expect(onFix).toHaveBeenCalledWith('brno');
  });

  it('offers to include contacts without the field filled', () => {
    renderIntl(<EmptyDiagnostics data={diagnostics()} />);
    expect(screen.getByRole('button', { name: /^přidat$/i })).toBeInTheDocument();
  });
});

const breakdown = () => ({
  input: 1842,
  gates: [
    { key: 'suppressed' as const, count: 210 },
    { key: 'unsubscribed' as const, count: 301 },
    { key: 'unconfirmed' as const, count: 140 },
    { key: 'snoozed' as const, count: 40 },
    { key: 'processing_restricted' as const, count: 22 },
    { key: 'duplicate' as const, count: 0 },
    { key: 'sample' as const, count: 0 },
  ],
  willSend: 1129,
});

describe('audience breakdown', () => {
  it('lists the gates in the evaluation order, not alphabetically', () => {
    renderIntl(<AudienceBreakdown data={breakdown()} />);
    expect(screen.getAllByTestId('gate-label').map((node) => node.textContent)).toEqual([
      'na blokovaných adresách',
      'odhlášení',
      'nepotvrzené přihlášení k seznamu',
      'pozastavená komunikace na vlastní žádost',
      'omezené zpracování podle GDPR',
    ]);
  });

  it('makes the numbers add up', () => {
    const data = breakdown();
    renderIntl(<AudienceBreakdown data={data} />);
    const removed = data.gates.reduce((sum, gate) => sum + gate.count, 0);
    expect(data.input - removed).toBe(data.willSend);
    expect(screen.getByText(/kampaň se odešle/i).textContent).toMatch(/1.129/);
  });

  it('makes every subtraction row a link to those specific people', () => {
    renderIntl(<AudienceBreakdown data={breakdown()} workspaceSlug="p" />);
    for (const row of screen.getAllByTestId('gate-row')) {
      expect(row.querySelector('a')?.getAttribute('href')).toContain('/contacts?');
    }
  });

  it('hides a gate with zero, so the list does not go stale', () => {
    renderIntl(
      <AudienceBreakdown data={{ ...breakdown(), gates: [{ key: 'duplicate', count: 0 }] }} />,
    );
    expect(screen.queryByText(/duplicitní e-maily/i)).toBeNull();
  });
});

const sixPresets = () =>
  [
    'never_opened',
    'never_clicked',
    'inactive_90d',
    'no_open_last_n',
    'unconfirmed_30d',
    'repeated_soft_bounces',
  ].map((key, index) => ({
    key,
    labelKey: `presets.${['neverOpened', 'neverClicked', 'inactive90d', 'noOpenLastN', 'unconfirmed30d', 'repeatedSoftBounces'][index]}.title`,
    explanationKey: `presets.${['neverOpened', 'neverClicked', 'inactive90d', 'noOpenLastN', 'unconfirmed30d', 'repeatedSoftBounces'][index]}.explanation`,
    cachedCount: null,
    cachedAt: null,
  }));

describe('preset cards', () => {
  it('shows six cards with the preset keys from part two', () => {
    renderIntl(<PresetGrid presets={sixPresets()} />);
    expect(screen.getAllByRole('article')).toHaveLength(6);
    for (const key of [
      'never_opened',
      'never_clicked',
      'inactive_90d',
      'no_open_last_n',
      'unconfirmed_30d',
      'repeated_soft_bounces',
    ]) {
      expect(screen.getByTestId(`preset-${key}`)).toBeInTheDocument();
    }
  });

  it('puts the sent count condition on the card, not in a tooltip', () => {
    renderIntl(<PresetGrid presets={sixPresets()} />);
    expect(screen.getByText(/dostali aspoň 3 e-maily a žádný neotevřeli/i)).toBeInTheDocument();
    expect(screen.getByText(/dostali aspoň 5 e-mailů a v žádném neklikli/i)).toBeInTheDocument();
  });

  it('shows count, never zero, for a preset never counted', () => {
    // `onRecount` se předává schválně: karta počítací tlačítko bez obsluhy
    // vůbec nevykreslí, aby na ní nezůstal prvek, po kterém se nic nestane.
    renderIntl(<PresetGrid presets={[sixPresets()[0]!]} onRecount={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^spočítat$/i })).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('bez obsluhy se počítací tlačítko na kartě nenabídne', () => {
    renderIntl(<PresetGrid presets={[sixPresets()[0]!]} />);
    expect(screen.queryByRole('button', { name: /^spočítat$/i })).toBeNull();
  });

  it('makes use create a copy with the preset key, not a link to a shared definition', async () => {
    const onUse = vi.fn();
    renderIntl(<PresetGrid presets={[sixPresets()[0]!]} onUse={onUse} />);
    await userEvent.click(screen.getByRole('button', { name: /^použít$/i }));
    expect(onUse).toHaveBeenCalledWith({ preset_key: 'never_opened' });
  });
});

describe('reactivation cleanup', () => {
  const segment = { name: 'Neaktivní', count: 1842 };

  it('explains freezing in terms of the consequence', () => {
    renderIntl(<CleanupScenario step="freeze" segment={segment} />);
    expect(screen.getByText(/kdo se mezitím sám ozve, z úklidu vypadne/i)).toBeInTheDocument();
  });

  it('offers three actions described by consequence, defaulting to unsubscribe', () => {
    renderIntl(<CleanupScenario step="action" segment={segment} />);
    expect(screen.getByRole('radio', { name: /odhlásit je z odběru/i })).toBeChecked();
    expect(
      screen.getByText(/zůstanou v databázi, ale kampaně jim už neposíláme/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/nenávratně. může jen vlastník projektu/i)).toBeInTheDocument();
  });

  it('offers delete only to the owner', () => {
    renderIntl(<CleanupScenario step="action" role="admin" segment={segment} />);
    expect(screen.getByRole('radio', { name: /smazat je/i })).toBeDisabled();
  });

  it('shows the final confirmation with all four numbers and three buttons', () => {
    renderIntl(
      <CleanupScenario
        step="confirm"
        segment={segment}
        campaign={{ name: 'Zajímá vás to', sentAt: '18. 7.', sent: 2480, responded: 638 }}
        days={3}
      />,
    );
    const body = document.body.textContent ?? '';
    // Čeština odděluje tisíce i části data NEZLOMITELNOU mezerou, a jsou dvě
    // různé: U+00A0 a U+202F (úzká). Které přesně, rozhoduje `Intl` podle verze
    // ICU, takže se obě před porovnáním nahradí tečkou a očekávané hodnoty
    // se píšou s tečkou.
    //
    // Zapisují se ESCAPEM, ne doslovným znakem. V editoru jsou k nerozeznání
    // od obyčejné mezery a lint je hlásí jako podezřelý znak; při plošném
    // úklidu „neviditelných mezer" jsem je jednou omylem nahradil obyčejnými
    // a rozbil tím právě tenhle regulární výraz.
    for (const value of ['1.842', '2.480', '638', '18. 7.']) {
      expect(body.replace(/\u00a0|\u202f/g, '.')).toContain(value);
    }
    for (const name of [/zkontrolovat/i, /odložit o 14 dní/i, /zrušit úklid/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('offers downloading the affected contacts before the cleanup runs', () => {
    renderIntl(<CleanupScenario step="confirm" segment={segment} days={3} />);
    expect(screen.getByRole('button', { name: /stáhnout těch/i }).textContent).toMatch(
      /1\u00a0842/,
    );
  });

  it('requires typing the segment name, because this is protection level N4', async () => {
    renderIntl(<CleanupScenario step="confirm" segment={segment} days={3} />);
    const confirm = screen.getByRole('button', { name: /zkontrolovat/i });
    expect(screen.getByLabelText(/opište název segmentu/i)).toBeInTheDocument();
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(screen.getByLabelText(/opište název segmentu/i), 'Neaktivní');
    expect(confirm).toHaveAttribute('aria-disabled', 'false');
  });
});
