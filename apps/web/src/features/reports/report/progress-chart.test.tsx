// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { ProgressChart, type ProgressPoint } from './progress-chart';

/**
 * TENHLE SOUBOR HLÍDÁ, ŽE GRAF NEKRESLÍ NEMĚŘENÉ ŘADY.
 *
 * Report u kampaně bez zpětné vazby od odesílací služby ukazoval v dlaždici
 * „Doručeno: Zatím nevíme" a o kus níž plochou čáru Doručeno na nule. Dvě
 * opačná tvrzení o téže věci na jedné obrazovce; nula z chybějícího údaje
 * vypadá jako měření. Kdyby test spadl, neupravuj ho: znamená to, že se do
 * grafu vrátila řada, kterou nemáme čím naplnit.
 *
 * Vlastní kreslení obstarává `ReportChart` za líznou hranicí a recharts se
 * v jsdom nevykreslí. Měří se proto TABULKA HODNOT, kterou komponenta grafu
 * vydává jako přístupnou alternativu, a věta o vynechané řadě.
 */
const messages = {
  reports: csReports,
  chart: { showTable: 'Zobrazit tabulku', hideTable: 'Skrýt' },
};

const points: ProgressPoint[] = [
  { at: '2026-08-04T12:45:00.000Z', sent: 2, delivered: 0, opens_unique: 0, clicks_unique: 0 },
];

function renderChart(measured: { delivered: boolean; opens: boolean; clicks: boolean }) {
  render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ProgressChart
        points={points}
        compacted={false}
        granularity="5m"
        onGranularityChange={vi.fn()}
        measured={measured}
      />
    </NextIntlClientProvider>,
  );
}

describe('ProgressChart', () => {
  it('u neznámé doručenosti řadu Doručeno nekreslí a řekne proč', async () => {
    renderChart({ delivered: false, opens: true, clicks: true });

    await waitFor(() =>
      expect(screen.getByText(csReports.report.chart.omittedDelivered)).toBeVisible(),
    );
    expect(screen.queryByText(csReports.report.chart.omittedOpens)).toBeNull();
  });

  it('u vypnutého měření vynechá otevření i prokliky', async () => {
    renderChart({ delivered: true, opens: false, clicks: false });

    await waitFor(() =>
      expect(screen.getByText(csReports.report.chart.omittedOpens)).toBeVisible(),
    );
    expect(screen.getByText(csReports.report.chart.omittedClicks)).toBeVisible();
    expect(screen.queryByText(csReports.report.chart.omittedDelivered)).toBeNull();
  });

  it('když se měří všechno, žádnou řadu nevynechává', () => {
    renderChart({ delivered: true, opens: true, clicks: true });

    expect(screen.queryAllByTestId('chart-omitted-series')).toHaveLength(0);
  });
});
