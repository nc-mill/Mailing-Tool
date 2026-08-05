import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './test-utils';
import { ProgressView, refreshDelayMs } from './progress-view';
import type { CampaignProgress } from './progress-screen';

const sendNow = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('./actions', () => ({
  cancelCampaignAction: vi.fn().mockResolvedValue({ status: 'success' }),
  pauseCampaignAction: vi.fn().mockResolvedValue({ status: 'success' }),
  resumeCampaignAction: vi.fn().mockResolvedValue({ status: 'success' }),
  undoCampaignAction: vi.fn().mockResolvedValue({ status: 'success' }),
  sendCampaignNowAction: (input: unknown) => sendNow(input),
}));

const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh }),
  };
});

function progress(over: Partial<CampaignProgress> = {}): CampaignProgress {
  return {
    campaign_id: 'k1',
    status: 'sending',
    counters: {
      total: 3,
      sent: 0,
      failed: 0,
      skipped: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      pending: 3,
    },
    ambiguous_count: 0,
    rate_per_second: null,
    eta_seconds: null,
    stalled: false,
    pause_reason: null,
    undo_remaining_seconds: 40,
    delivery_events_seen: false,
    finished: false,
    updated_at: '2026-08-04T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  refresh.mockClear();
  sendNow.mockClear();
});

/**
 * Interval obnovování. Pevných pět sekund bylo špatně na obou koncích: kampaň
 * na tři adresy doběhla dřív, než přišlo první obnovení, a kampaň na sto tisíc
 * adres se ptala serveru osmnáctkrát za minutu i hodinu poté, co bylo zajímavé
 * už jen to, jestli je hotovo.
 */
describe('interval obnovování', () => {
  it('začíná rychle, aby se hnula i kampaň na tři adresy', () => {
    expect(refreshDelayMs(0)).toBe(2_000);
    expect(refreshDelayMs(29_000)).toBe(2_000);
  });

  it('u delší rozesílky se prodlužuje', () => {
    expect(refreshDelayMs(60_000)).toBe(5_000);
    expect(refreshDelayMs(10 * 60_000)).toBe(15_000);
  });

  it('nikdy se neptá častěji než jednou za dvě sekundy', () => {
    for (const elapsed of [0, 1, 1_000, 29_999, 30_000, 3_600_000]) {
      expect(refreshDelayMs(elapsed)).toBeGreaterThanOrEqual(2_000);
    }
  });
});

describe('živý průběh', () => {
  it('běžící kampaň se sama obnovuje', () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(
        <ProgressView progress={progress()} workspaceId="w1" basePath="/w/moje" />,
      );
      expect(refresh).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(2_100);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(2_100);
      });
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Dojetá kampaň se neobnovuje. Jinak by se obrazovka ptala serveru navždy. */
  it('po dojetí se obnovování zastaví', () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(
        <ProgressView
          progress={progress({ status: 'sent', finished: true })}
          workspaceId="w1"
          basePath="/w/moje"
        />,
      );
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Odeslat teď', () => {
  it('volá server, ne jen ukončení čekání v prohlížeči', async () => {
    renderWithProviders(<ProgressView progress={progress()} workspaceId="w1" basePath="/w/moje" />);
    await userEvent.click(screen.getByTestId('send-now'));
    expect(sendNow).toHaveBeenCalledWith({ workspaceId: 'w1', campaignId: 'k1' });
  });

  it('hned po stisku je vidět, že se spouští, ne dál běžící odpočet', async () => {
    renderWithProviders(<ProgressView progress={progress()} workspaceId="w1" basePath="/w/moje" />);
    await userEvent.click(screen.getByTestId('send-now'));
    expect(screen.getByText('Spouštíme rozesílku…')).toBeInTheDocument();
    expect(screen.queryByText(/Odesíláme za/)).toBeNull();
  });

  it('odkaz na report vede na cestu projektu', () => {
    renderWithProviders(<ProgressView progress={progress()} workspaceId="w1" basePath="/w/moje" />);
    expect(screen.getByTestId('progress-to-report')).toHaveAttribute(
      'href',
      '/w/moje/campaigns/k1/report',
    );
  });
});
