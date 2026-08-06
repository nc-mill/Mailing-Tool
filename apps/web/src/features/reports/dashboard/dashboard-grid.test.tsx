// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import csReports from '../../../../../../packages/i18n/messages/cs/reports.json';
import { DashboardGrid } from './dashboard-grid';

/**
 * Hlavička obrazovky vede na import kontaktů a na založení kampaně přes router,
 * takže ho test musí mít. Bez mocku vyhodí `useRouter` v jsdom „invariant
 * expected app router to be mounted" a spadne celý přehled, ne jen ta dvě
 * tlačítka.
 */
const push = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const messages = { reports: csReports };

function renderGrid(workspaceSlug = 'ws-1') {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <DashboardGrid workspaceSlug={workspaceSlug} />
    </NextIntlClientProvider>,
  );
}

const EMPTY_TILES = {
  sent: { status: 'ok', data: { value: 0 }, computed_at: '2026-08-01T00:00:00.000Z', stale: false },
  click_rate: {
    status: 'ok',
    data: { rate: null, delta: null },
    computed_at: '2026-08-01T00:00:00.000Z',
    stale: false,
  },
  open_rate: {
    status: 'ok',
    data: { rate: null, machineShare: null },
    computed_at: '2026-08-01T00:00:00.000Z',
    stale: false,
  },
  problems: {
    status: 'ok',
    data: { bounceRate: null, complaintRate: null, level: 'ok' },
    computed_at: '2026-08-01T00:00:00.000Z',
    stale: false,
  },
  web_active: {
    status: 'ok',
    data: { contacts: 0 },
    computed_at: '2026-08-01T00:00:00.000Z',
    stale: false,
  },
  recent_campaigns: {
    status: 'ok',
    data: { items: [] },
    computed_at: '2026-08-01T00:00:00.000Z',
    stale: false,
  },
  running: {
    status: 'ok',
    data: { campaign: null },
    computed_at: '2026-08-01T00:00:00.000Z',
    stale: false,
  },
};

describe('DashboardGrid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Reprodukuje přesně to, co dělá skutečné API: middleware autentizace
   * (`apps/web/src/lib/api/authenticate.ts`) skládá projekt aktéra typu
   * `user` z hlavičky `X-Workspace-Id` a bez ní vrátí `not_found` (404),
   * protože cesta `/api/v1/dashboard` žádný segment `/w/{slug}` nemá.
   *
   * BEZ OPRAVY tenhle test padá: `DashboardGrid` volá `fetchJson` bez
   * hlavičky, mock vrátí 404, celý přehled skončí v `.catch()` s prázdným
   * `tiles: {}` a čtyři dlaždice ukážou „Tuhle dlaždici se nepodařilo
   * načíst.“ místo čísel a prázdných stavů.
   */
  it('pošle X-Workspace-Id, takže se čerstvě instalovaný (prázdný) přehled načte bez chyb', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get('X-Workspace-Id') !== 'ws-1') {
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'not_found', request_id: 'req-1' }), {
            status: 404,
            headers: { 'Content-Type': 'application/problem+json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            period_days: 30,
            computed_at: '2026-08-01T00:00:00.000Z',
            tiles: EMPTY_TILES,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderGrid('ws-1');

    await waitFor(() => {
      // Dvakrát: dlaždice „Kliklo“ i „Otevřelo“ hlásí stejnou prázdnou větu.
      expect(
        screen.getAllByText('Zatím žádná odeslaná kampaň, proto tu nejsou míry.'),
      ).toHaveLength(2);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(sentHeaders.get('X-Workspace-Id')).toBe('ws-1');
  });

  /**
   * REGRESE: přehled hlásil „Otevřelo 185,7 %".
   *
   * Server u kampaně bez zpětné vazby od odesílací služby míru nespočítá
   * (`rate: null`) a pošle místo ní počty a informaci, kolika kampaní se to
   * týká. Obrazovka na to musí odpovědět naměřeným číslem a větou, ne prázdným
   * místem a ne procentem.
   */
  it('u kampaně s neznámou doručeností ukáže počty a vysvětlení místo procenta', async () => {
    const tiles = {
      ...EMPTY_TILES,
      sent: {
        status: 'ok',
        data: { value: 14 },
        computed_at: '2026-08-01T00:00:00.000Z',
        stale: false,
      },
      click_rate: {
        status: 'ok',
        data: { rate: null, delta: null, clicks: 3, unknown: { campaigns: 6, sent: 14 } },
        computed_at: '2026-08-01T00:00:00.000Z',
        stale: false,
      },
      open_rate: {
        status: 'ok',
        data: {
          rate: null,
          machineShare: null,
          opens: 26,
          unknown: { campaigns: 6, sent: 14 },
        },
        computed_at: '2026-08-01T00:00:00.000Z',
        stale: false,
      },
      problems: {
        status: 'ok',
        data: {
          bounceRate: null,
          complaintRate: null,
          level: 'unknown',
          unknown: { campaigns: 6, sent: 14 },
        },
        computed_at: '2026-08-01T00:00:00.000Z',
        stale: false,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              period_days: 30,
              computed_at: '2026-08-01T00:00:00.000Z',
              tiles,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );

    renderGrid('ws-1');

    await waitFor(() => {
      expect(screen.getByTestId('opens-absolute')).toHaveTextContent('26 otevření');
    });
    expect(screen.getByTestId('clicks-absolute')).toHaveTextContent('3 prokliky');
    expect(screen.getByTestId('problems-unknown')).toHaveTextContent('zatím nevíme');
    // Žádné procento z odhadnutého jmenovatele.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  /**
   * Změna proti minulému období je na dlaždici napsaná ZNAMÉNKEM, ne jen
   * barvou: kdo barvy nerozliší, musí pořád poznat, jestli číslo stouplo.
   * Když server porovnávat nemá s čím (`delta: null`), řádek se nevykreslí,
   * protože „0 %" by tvrdilo, že se nic nezměnilo.
   */
  it('ukáže změnu proti minulému období se znaménkem, a jen když ji server pošle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              period_days: 30,
              computed_at: '2026-08-01T00:00:00.000Z',
              tiles: {
                ...EMPTY_TILES,
                sent: {
                  status: 'ok',
                  data: { value: 128, delta: 0.081 },
                  computed_at: '2026-08-01T00:00:00.000Z',
                  stale: false,
                },
                click_rate: {
                  status: 'ok',
                  data: { rate: 0.038, delta: -0.0525, clicks: 19 },
                  computed_at: '2026-08-01T00:00:00.000Z',
                  stale: false,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );

    renderGrid('ws-1');

    await waitFor(() => {
      expect(screen.getByText(/\+8,1/)).toBeInTheDocument();
    });
    expect(screen.getByText(/-5,3/)).toBeInTheDocument();
    // Otevření mají `rate: null`, tedy žádnou deltu: věta o období smí být
    // v dokumentu právě dvakrát, jednou u odeslaných a jednou u prokliků.
    expect(screen.getAllByText('od minulého období')).toHaveLength(2);
  });

  it('poslední kampaně mají odkaz na report, počet zpráv a stav', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              period_days: 30,
              computed_at: '2026-08-01T00:00:00.000Z',
              tiles: {
                ...EMPTY_TILES,
                recent_campaigns: {
                  status: 'ok',
                  data: {
                    items: [
                      {
                        campaignId: 'c1',
                        name: 'Sloučeny krok 1',
                        startedAt: '2026-07-30T09:00:00.000Z',
                        clickRate: null,
                        deliveredKnown: false,
                        clicks: 3,
                        sent: 8,
                      },
                    ],
                  },
                  computed_at: '2026-08-01T00:00:00.000Z',
                  stale: false,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );

    renderGrid('ws-1');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Sloučeny krok 1' })).toHaveAttribute(
        'href',
        '/w/ws-1/campaigns/c1/report',
      );
    });
    expect(screen.getByText('8 zpráv')).toBeInTheDocument();
    // U kampaně bez známé doručenosti nese stav POČET prokliků, ne procento.
    expect(screen.getByText('3 prokliky')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('dlaždice aktivity na webu vede na obrazovku webové aktivity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              period_days: 30,
              computed_at: '2026-08-01T00:00:00.000Z',
              tiles: {
                ...EMPTY_TILES,
                web_active: {
                  status: 'ok',
                  data: { contacts: 3 },
                  computed_at: new Date().toISOString(),
                  stale: false,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );

    renderGrid('ws-1');

    await waitFor(() => {
      expect(screen.getByTestId('web-active-link')).toHaveAttribute('href', '/w/ws-1/stats/web');
    });
  });
});
