import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChartFrame } from './chart-frame';

const series = [
  {
    id: 'delivered',
    label: 'Doručeno',
    pattern: 'solid' as const,
    points: [
      { x: '1. 7.', y: 1200 },
      { x: '2. 7.', y: 1180 },
    ],
  },
  {
    id: 'clicked',
    label: 'Kliklo',
    pattern: 'dashed' as const,
    points: [
      { x: '1. 7.', y: 210 },
      { x: '2. 7.', y: 190 },
    ],
  },
];

const labels = {
  showTable: 'Zobrazit hodnoty jako tabulku',
  hideTable: 'Skrýt tabulku',
  tableCaption: 'Hodnoty grafu',
  periodColumn: 'Období',
};

describe('ChartFrame', () => {
  it('graf sám o sobě je pro čtečku skrytý, data nese tabulka', () => {
    render(
      <ChartFrame title="Vývoj v čase" series={series} labels={labels}>
        {null}
      </ChartFrame>,
    );
    expect(screen.getByTestId('chart-visual')).toHaveAttribute('aria-hidden', 'true');
  });

  it('tabulka s hodnotami je vždy v DOM, jen vizuálně sbalená', () => {
    render(
      <ChartFrame title="Vývoj v čase" series={series} labels={labels}>
        {null}
      </ChartFrame>,
    );
    const table = screen.getByRole('table', { name: 'Hodnoty grafu' });
    expect(within(table).getByText('1 200')).toBeInTheDocument();
    expect(within(table).getByText('210')).toBeInTheDocument();
  });

  it('tabulku jde rozbalit a sbalit z klávesnice', async () => {
    const user = userEvent.setup();
    render(
      <ChartFrame title="Vývoj v čase" series={series} labels={labels}>
        {null}
      </ChartFrame>,
    );
    const toggle = screen.getByRole('button', { name: 'Zobrazit hodnoty jako tabulku' });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Skrýt tabulku' })).toBeVisible();
  });

  it('každá řada má kromě barvy i vzor a popisek', () => {
    render(
      <ChartFrame title="Vývoj v čase" series={series} labels={labels}>
        {null}
      </ChartFrame>,
    );
    const legend = screen.getByTestId('chart-legend');
    expect(within(legend).getByText('Doručeno')).toBeVisible();
    expect(within(legend).getByText('Kliklo')).toBeVisible();
    expect(legend.querySelectorAll('[data-pattern]')).toHaveLength(2);
  });

  it('graf má nadpis svázaný s oblastí', () => {
    render(
      <ChartFrame title="Vývoj v čase" series={series} labels={labels}>
        {null}
      </ChartFrame>,
    );
    expect(screen.getByRole('figure', { name: 'Vývoj v čase' })).toBeInTheDocument();
  });
});
