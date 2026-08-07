import '@testing-library/jest-dom/vitest';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { formats } from '@mlain/i18n/formats';
import { afterEach, describe, expect, it, vi } from 'vitest';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import { JobsBadgeLive } from './jobs-badge-live';
import { JOBS_BADGE_REFRESH_MS } from './refresh';

const push = vi.fn();

vi.mock('@mlain/i18n/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

function renderBadge() {
  return render(
    <NextIntlClientProvider
      locale="cs"
      messages={{ common: csCommon }}
      formats={formats}
      timeZone="Europe/Prague"
    >
      <JobsBadgeLive workspaceId="w-1" jobsHref="/w/eshop-kolo/jobs" />
    </NextIntlClientProvider>,
  );
}

function respondWith(runningCount: number) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [], running_count: runningCount }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  push.mockClear();
});

describe('odznak úloh v hlavičce', () => {
  it('načte počet běžících úloh a napíše ho', async () => {
    vi.stubGlobal('fetch', respondWith(2));
    renderBadge();
    await waitFor(() => expect(screen.getByTestId('jobs-badge-count')).toHaveTextContent('2'));
    expect(screen.getByRole('button')).toHaveAccessibleName('Běží 2 úlohy');
  });

  /** Odznak potřebuje jen číslo, ne seznam. Proto se ptá s `limit=1`. */
  it('netahá kvůli číslu celý seznam úloh', async () => {
    const fetchMock = respondWith(1);
    vi.stubGlobal('fetch', fetchMock);
    renderBadge();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/jobs?limit=1&running=true');
  });

  it('bez běžících úloh ikona zůstává, jen bez čísla', async () => {
    const fetchMock = respondWith(0);
    vi.stubGlobal('fetch', fetchMock);
    renderBadge();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('jobs-badge-count')).toBeNull();
    expect(screen.getByRole('button')).toHaveAccessibleName('Úlohy');
  });

  it('kliknutí vede do Centra úloh', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', respondWith(0));
    renderBadge();
    await user.click(screen.getByRole('button'));
    expect(push).toHaveBeenCalledWith('/w/eshop-kolo/jobs');
  });

  it('dokud něco běží, počet se sám dorovnává', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith(1);
    vi.stubGlobal('fetch', fetchMock);
    renderBadge();
    // Nejdřív dojde načtení po připojení, teprve pak smí naskočit časovač:
    // ten se zapíná až podle počtu, který se z toho načtení vrátí.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOBS_BADGE_REFRESH_MS + 100);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  /**
   * Nejdražší chyba by byla trvale tikající hlavička: běží na KAŽDÉ stránce
   * aplikace, takže by dotazovala i projekt, ve kterém se měsíc nic nespustilo.
   */
  it('když neběží nic, hlavička se přestane ptát', async () => {
    vi.useFakeTimers();
    const fetchMock = respondWith(0);
    vi.stubGlobal('fetch', fetchMock);
    renderBadge();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOBS_BADGE_REFRESH_MS * 5);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
