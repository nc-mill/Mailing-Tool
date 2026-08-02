// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, waitFor } from '@testing-library/react';
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
});
