// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { DiagnosticsPanel } from './diagnostics-panel';
import type { StatsPayload } from './report-model';

/**
 * Diagnostika je poslední místo, kde má uživatel najít pravdu o tom, odkud se
 * čísla berou. Tvrdila ale „Doručení hlásí odesílací služba." u účtu, od kterého
 * nikdy nedorazila jediná zpětná zpráva, protože se rozhodovala jen podle typu
 * poskytovatele. Na téže stránce přitom stálo „Zatím nevíme".
 */
const messages = { reports: csReports };

function payloadWith(overrides: Partial<StatsPayload>): StatsPayload {
  return {
    campaign_id: 'c1',
    name: 'Test',
    subject: 'Předmět',
    status: 'sent',
    track_opens: true,
    track_clicks: true,
    delivered_source: 'provider_events',
    delivered_known: true,
    counts: { clicks_scanner: 0 },
    rates: {},
    open_breakdown: { verified: 0, machine: 0, uncertain: 0, total: 0, clicked_from_verified: 0 },
    predicted_opens: null,
    small_sample: false,
    audience_built_at: null,
    started_at: null,
    finished_at: null,
    first_event_at: null,
    last_event_at: null,
    version: 1,
    updated_at: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(payload: StatsPayload) {
  render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <DiagnosticsPanel payload={payload} />
    </NextIntlClientProvider>,
  );
}

describe('DiagnosticsPanel', () => {
  it('u neznámé doručenosti netvrdí, že ji hlásí odesílací služba', () => {
    renderPanel(payloadWith({ delivered_known: false, delivered_source: 'provider_events' }));

    expect(
      screen.getByText(csReports.report.diagnostics.deliveredSourceUnknown),
    ).toBeInTheDocument();
    expect(screen.queryByText(csReports.report.diagnostics.deliveredSourceProvider)).toBeNull();
  });

  it('u měřené doručenosti od služby to řekne', () => {
    renderPanel(payloadWith({ delivered_known: true, delivered_source: 'provider_events' }));

    expect(
      screen.getByText(csReports.report.diagnostics.deliveredSourceProvider),
    ).toBeInTheDocument();
  });

  it('u dopočtené doručenosti přizná, že jde o dopočet', () => {
    renderPanel(payloadWith({ delivered_known: true, delivered_source: 'derived_from_sent' }));

    expect(
      screen.getByText(csReports.report.diagnostics.deliveredSourceDerived),
    ).toBeInTheDocument();
  });
});
