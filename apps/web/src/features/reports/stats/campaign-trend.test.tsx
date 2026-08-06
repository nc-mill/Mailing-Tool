// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { CampaignTrend } from './campaign-trend';

const messages = { reports: csReports };

describe('CampaignTrend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Stejný jev jako `dashboard-grid.test.tsx`: `CampaignTrend` čte tutéž
   * `/api/v1/dashboard`. Bez hlavičky `X-Workspace-Id` skončí volání na 404
   * (`apps/web/src/lib/api/authenticate.ts:workspaceRefFrom`), protože cesta
   * API žádný segment `/w/{slug}` nenese.
   */
  it('volá /api/v1/dashboard s hlavičkou X-Workspace-Id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ tiles: { recent_campaigns: { status: 'ok', data: { items: [] } } } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <CampaignTrend workspaceSlug="ws-1" />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/dashboard?period=90');
    const headers = new Headers(init.headers);
    expect(headers.get('X-Workspace-Id')).toBe('ws-1');
  });

  /**
   * Statistiky nesmí být slepá ulice. Zadavatel report hledal právě tady
   * („předpokládal bych, že to bude ve statistikách") a tabulka měr sice
   * kampaně vypsala, ale prokliknout se z ní na konkrétní report nedalo.
   */
  it('jméno kampaně v tabulce vede na její report', async () => {
    const items = [1, 2, 3].map((n) => ({
      campaignId: `c${n}`,
      name: `Kampaň ${n}`,
      startedAt: `2026-07-0${n}T10:00:00.000Z`,
      sent: 1000,
      delivered: 990,
      deliveredEffective: 990,
      opens: 400,
      opensApple: 100,
      clicks: 90,
      unsubscribed: 3,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ tiles: { recent_campaigns: { status: 'ok', data: { items } } } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <CampaignTrend workspaceSlug="demo" />
      </NextIntlClientProvider>,
    );

    const link = await screen.findByRole('link', { name: 'Kampaň 2' });
    expect(link).toHaveAttribute('href', '/w/demo/campaigns/c2/report');
  });

  /**
   * Přepínač období je tentýž prvek jako na Přehledu a musí se opravdu ptát
   * serveru znovu. Bez toho by přepnutí jen přebarvilo tlačítko a čísla by
   * zůstala z původního okna, což je horší než přepínač nemít.
   */
  it('přepnutí období načte data znovu s novým parametrem', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          computed_at: '2026-08-05T13:31:00.000Z',
          tiles: { recent_campaigns: { status: 'ok', data: { items: [] } } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <CampaignTrend workspaceSlug="ws-1" />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const period7 = screen.getByRole('button', { name: '7 dní' });
    // Stav se nesděluje jen tmavou plochou, nese ho `aria-pressed`.
    expect(period7).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(period7);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      '/api/v1/dashboard?period=7',
    );
    expect(screen.getByRole('button', { name: '7 dní' })).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * REGRESE PROTI LŽIVÝM ČÍSLŮM: kampaň, u které neznáme doručenost, se z měr
   * vypouští. Kdyby o tom obrazovka mlčela, vypadal by graf ze zbytku jako
   * celý obraz období.
   */
  it('kampaně bez známé doručenosti spočítá do dlaždice „Mimo měření"', async () => {
    const items = [1, 2, 3, 4].map((n) => ({
      campaignId: `c${n}`,
      name: `Kampaň ${n}`,
      startedAt: `2026-07-0${n}T10:00:00.000Z`,
      sent: 100,
      delivered: 90,
      deliveredEffective: 90,
      // Poslední dvě kampaně nemají od odesílací služby ani jednu zprávu.
      deliveredKnown: n <= 2,
      opens: 40,
      opensApple: 10,
      clicks: 9,
      unsubscribed: 1,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            computed_at: '2026-08-05T13:31:00.000Z',
            tiles: { recent_campaigns: { status: 'ok', data: { items } } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <CampaignTrend workspaceSlug="ws-1" />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('trend-excluded-count')).toHaveTextContent('2');
    });
    // Dvě použitelné kampaně jsou míň než tři, takže se místo grafu píše proč.
    expect(screen.getByTestId('trend-empty')).toBeInTheDocument();
    expect(screen.getByTestId('trend-excluded')).toHaveTextContent('zatím nevíme');
  });
});
