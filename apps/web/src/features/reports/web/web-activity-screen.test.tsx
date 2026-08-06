// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { WebActivityScreen, type WebActivityPayload } from './web-activity-screen';

const messages = { reports: csReports };

const BASE: WebActivityPayload = {
  period_days: 7,
  computed_at: '2026-08-05T00:00:00.000Z',
  known_contacts: 0,
  anonymous_visitors: 0,
  page_views: 0,
  other_events: 0,
  last_event_at: null,
  pages: [],
  events: [],
  referrers: [],
  visits: [],
};

function renderScreen(payload: WebActivityPayload) {
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
      <WebActivityScreen workspaceSlug="ws-1" />
    </NextIntlClientProvider>,
  );
}

describe('WebActivityScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('odděluje známé lidi od neznámých návštěvníků a vypíše, co si prohlédli', async () => {
    renderScreen({
      ...BASE,
      known_contacts: 1,
      anonymous_visitors: 2,
      page_views: 4,
      other_events: 1,
      last_event_at: '2026-08-04T22:17:23.000Z',
      pages: [{ path: '/vyprodej', views: 3, visitors: 2 }],
      events: [{ name: 'product_viewed', count: 1, visitors: 1 }],
      referrers: [{ host: 'seznam.cz', visits: 2 }],
      visits: [
        {
          contact_id: 'k-1',
          email: 'petr@example.cz',
          name: 'Petr Novák',
          started_at: '2026-08-04T22:15:00.000Z',
          ended_at: '2026-08-04T22:17:23.000Z',
          page_views: 2,
          events: 3,
          entry_path: '/vyprodej',
          last_path: '/kosik',
          referrer_host: 'seznam.cz',
        },
        {
          contact_id: null,
          email: null,
          name: null,
          started_at: '2026-08-04T20:00:00.000Z',
          ended_at: '2026-08-04T20:05:00.000Z',
          page_views: 1,
          events: 1,
          entry_path: '/kontakt',
          last_path: '/kontakt',
          referrer_host: null,
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('web-summary')).toHaveTextContent(
        'Byl tu 1 člověk, kterého známe jménem.',
      );
    });
    expect(screen.getByTestId('web-summary')).toHaveTextContent(
      'K tomu 2 zatím neznámí návštěvníci.',
    );
    expect(screen.getByRole('link', { name: 'Petr Novák' })).toHaveAttribute(
      'href',
      '/w/ws-1/contacts/k-1',
    );
    expect(screen.getByText('Zatím neznámý návštěvník')).toBeInTheDocument();
    // Dvakrát: u návštěvy ve sloupci „Přišel z" a v žebříčku zdrojů.
    expect(screen.getAllByText('seznam.cz')).toHaveLength(2);
    // Návštěva bez odkazující stránky se označí slovem, ne prázdnou buňkou.
    expect(screen.getByText('přímo')).toBeInTheDocument();
  });

  /**
   * Dlaždice s čísly jsou hlavní obsah obrazovky a musí sedět na odpověď
   * serveru. Známé lidi a neznámé návštěvníky drží ve dvou různých dlaždicích
   * schválně: sečíst je dohromady by tvrdilo, že víme, kdo ti neznámí jsou.
   */
  it('dlaždice ukazují počty z odpovědi serveru', async () => {
    renderScreen({
      ...BASE,
      known_contacts: 1,
      anonymous_visitors: 2,
      page_views: 4,
      other_events: 1,
      last_event_at: '2026-08-04T22:17:23.000Z',
    });

    const known = await screen.findByRole('heading', { name: 'Známí lidé' });
    expect(known.closest('section')).toHaveTextContent('1');
    expect(
      screen.getByRole('heading', { name: 'Zatím neznámí' }).closest('section'),
    ).toHaveTextContent('2');
    expect(
      screen.getByRole('heading', { name: 'Zobrazení stránek' }).closest('section'),
    ).toHaveTextContent('4');
    expect(
      screen.getByRole('heading', { name: 'Další akce' }).closest('section'),
    ).toHaveTextContent('1');
  });

  it('když nikdy nic nedorazilo, pošle uživatele nastavit měření', async () => {
    renderScreen(BASE);
    await waitFor(() => {
      expect(screen.getByTestId('web-empty-never')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Nastavit měření webu' })).toHaveAttribute(
      'href',
      '/w/ws-1/settings/tracking',
    );
  });

  it('prázdné období od nenasazeného měření rozlišuje', async () => {
    renderScreen({ ...BASE, last_event_at: '2026-07-01T10:00:00.000Z' });
    await waitFor(() => {
      expect(screen.getByTestId('web-empty-period')).toHaveTextContent('Naposled se někdo objevil');
    });
    expect(screen.queryByTestId('web-empty-never')).not.toBeInTheDocument();
  });
});
