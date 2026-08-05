// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { ProblemsPanel } from './problems-panel';
import { feedbackGap } from './provider-feedback';
import type { StatsPayload } from './report-model';

/**
 * NULA A „NEMĚŘÍME" JSOU DVĚ RŮZNÉ VĚCI.
 *
 * Události `bounced_hard`, `bounced_soft` a `complained` vznikají JEDINĚ
 * z oznámení odesílací služby (SNS od SES). Odesílací proces je nezapisuje,
 * takže u SMTP účtu zůstávají trvale na nule. Panel na to dřív hlásil „0"
 * a „v normě", tedy „poslali jsme a nikomu se to neodrazilo".
 *
 * Kdyby tenhle soubor spadl: nezměřený údaj zase vypadá jako naměřená nula.
 */
const messages = { reports: csReports };

const payload = {
  campaign_id: 'c1',
  name: 'Letní výprodej',
  subject: 'Sleva 30 %',
  status: 'sent',
  track_opens: true,
  track_clicks: true,
  delivered_source: 'provider_events',
  counts: {
    sent: 1153,
    delivered: 1141,
    delivered_effective: 1141,
    bounced_hard: 8,
    bounced_soft: 4,
    complained: 1,
    failed: 2,
  },
  rates: { bounce_rate: 0.0104, complaint_rate: 0.00088 },
  open_breakdown: { verified: 0, machine: 0, uncertain: 0, total: 0, clicked_from_verified: 0 },
  predicted_opens: null,
  small_sample: false,
  audience_built_at: null,
  started_at: null,
  finished_at: null,
  first_event_at: null,
  last_event_at: null,
  version: 1,
  updated_at: '2026-07-31T18:02:00.000Z',
} as unknown as StatsPayload;

/** Mezera se počítá touž funkcí jako v reportu, ať test neměří jinou věc než produkt. */
function renderPanel(next: Partial<StatsPayload>, now = new Date('2026-08-01T12:00:00.000Z')) {
  const merged = { ...payload, ...next };
  render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ProblemsPanel payload={merged} gap={feedbackGap(merged, now)} onShowWho={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe('panel problémů', () => {
  it('u účtu se zpětnými událostmi ukáže čísla i míry', () => {
    renderPanel({});

    expect(screen.getByText('1,04 %')).toBeInTheDocument();
    expect(screen.queryByTestId('problems-not-measured')).not.toBeInTheDocument();
    // Tři řádky, u každého nabídka „Zobrazit komu".
    expect(screen.getAllByRole('button', { name: csReports.report.problems.showWho })).toHaveLength(
      3,
    );
  });

  it('bez zpětných událostí řekne u odrazů a stížností „neměří se", ne nulu', () => {
    renderPanel({
      delivered_source: 'derived_from_sent',
      counts: { ...payload.counts, bounced_hard: 0, bounced_soft: 0, complained: 0 },
      rates: { bounce_rate: 0, complaint_rate: 0 },
    });

    const bounced = screen.getByText(csReports.report.problems.bounced).closest('tr');
    const complained = screen.getByText(csReports.report.problems.complained).closest('tr');

    expect(bounced).toHaveTextContent(csReports.report.problems.notMeasured);
    expect(bounced).not.toHaveTextContent(csReports.report.problems.withinNorm);
    expect(complained).toHaveTextContent(csReports.report.problems.notMeasured);

    // Vysvětlení, PROČ tam čísla nejsou, patří k panelu.
    expect(screen.getByTestId('problems-not-measured')).toBeInTheDocument();
  });

  it('selhání odesílání se měří i bez zpětných událostí', () => {
    renderPanel({
      delivered_source: 'derived_from_sent',
      counts: { ...payload.counts, bounced_hard: 0, bounced_soft: 0, complained: 0 },
      rates: { bounce_rate: 0, complaint_rate: 0 },
    });

    const failed = screen.getByText(csReports.report.problems.failed).closest('tr');
    expect(failed).toHaveTextContent('2');
    expect(failed).not.toHaveTextContent(csReports.report.problems.notMeasured);
  });
});
