// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { WebActivityPanel, type CampaignWebActivityPayload } from './web-activity-panel';

const messages = { reports: csReports };

const BASE: CampaignWebActivityPayload = {
  campaign_id: 'c-1',
  started_at: '2026-08-04T15:35:52.000Z',
  window_hours: 24,
  clicked_contacts: 0,
  visitor_contacts: 0,
  page_views: 0,
  other_events: 0,
  sessions: 0,
  last_visit_at: null,
  pages: [],
  events: [],
  visitors: [],
};

function renderPanel(payload: CampaignWebActivityPayload) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <WebActivityPanel campaignId="c-1" workspaceSlug="ws-1" />
    </NextIntlClientProvider>,
  );
}

describe('WebActivityPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('napíše větami, kolik lidí kliklo, kolik z nich přišlo a co si prohlédli', async () => {
    renderPanel({
      ...BASE,
      clicked_contacts: 3,
      visitor_contacts: 1,
      page_views: 2,
      other_events: 1,
      sessions: 1,
      last_visit_at: '2026-08-04T22:17:23.000Z',
      pages: [{ path: '/vyprodej', views: 2, visitors: 1 }],
      events: [{ name: 'product_viewed', count: 1, visitors: 1 }],
      visitors: [
        {
          contact_id: 'k-1',
          email: 'petr@example.cz',
          name: 'Petr Novák',
          page_views: 2,
          events: 3,
          first_seen_at: '2026-08-04T22:15:00.000Z',
          last_seen_at: '2026-08-04T22:17:23.000Z',
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('web-activity-summary')).toHaveTextContent(
        'V téhle kampani klikli 3 lidé.',
      );
    });
    expect(screen.getByTestId('web-activity-summary')).toHaveTextContent(
      'Na web z nich přišel 1 člověk.',
    );
    // U každého čísla musí být vidět, z čeho se počítá.
    expect(screen.getByText(/do 24 hodin od jejich kliknutí/)).toBeInTheDocument();
    expect(screen.getByText('/vyprodej')).toBeInTheDocument();
    expect(screen.getByText('product_viewed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Petr Novák' })).toHaveAttribute(
      'href',
      '/w/ws-1/contacts/k-1',
    );
  });

  it('když nikdo neklikl, řekne to a nepředstírá nulovou návštěvnost', async () => {
    renderPanel(BASE);
    await waitFor(() => {
      expect(screen.getByText(/zatím nikdo neklikl na odkaz/)).toBeInTheDocument();
    });
  });

  it('klikli, ale na web nepřišli: poradí, kde zkontrolovat měření', async () => {
    renderPanel({ ...BASE, clicked_contacts: 5 });
    await waitFor(() => {
      expect(screen.getByText(/na webu jsme z nich nikoho nezaznamenali/)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Zkontrolovat měření webu' })).toHaveAttribute(
      'href',
      '/w/ws-1/settings/tracking',
    );
  });

  it('u neodeslané kampaně nic nepočítá', async () => {
    renderPanel({ ...BASE, started_at: null });
    await waitFor(() => {
      expect(screen.getByText(/Kampaň se ještě neodeslala/)).toBeInTheDocument();
    });
  });
});
