import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProgressScreen, type CampaignProgress } from './progress-screen';
import { UndoCountdown } from './undo-countdown';
import { renderWithProviders } from './test-utils';

const progress: CampaignProgress = {
  campaign_id: 'k1',
  status: 'sending',
  counters: {
    total: 1129,
    sent: 428,
    failed: 1,
    skipped: 0,
    delivered: 421,
    bounced: 6,
    complained: 0,
    pending: 700,
  },
  ambiguous_count: 0,
  rate_per_second: 14,
  eta_seconds: 50,
  stalled: false,
  pause_reason: null,
  undo_remaining_seconds: 0,
  updated_at: '2026-08-01T12:40:00.000Z',
};

function paused(code: string): CampaignProgress {
  return {
    ...progress,
    status: 'paused',
    pause_reason: { code, source: 'app', at: '2026-08-01T12:00:00.000Z' },
  };
}

describe('okno na zrušení', () => {
  it('ukazuje odpočet a velké tlačítko Vzít zpět', () => {
    renderWithProviders(<UndoCountdown remainingSeconds={47} onUndo={vi.fn()} />);
    expect(screen.getByText('Odesíláme za 47 s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vzít zpět' })).toBeInTheDocument();
  });

  it('po vypršení se tlačítko změní na Pozastavit', () => {
    renderWithProviders(<UndoCountdown remainingSeconds={0} onUndo={vi.fn()} onPause={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pozastavit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vzít zpět' })).toBeNull();
  });
});

describe('obrazovka průběhu', () => {
  it('u Odesláno i Doručeno je vysvětlení, proč se čísla nerovnají', () => {
    renderWithProviders(<ProgressScreen progress={progress} />);
    expect(screen.getByText(/Předáno poštovnímu serveru/)).toBeInTheDocument();
    expect(screen.getByText(/Potvrzení chodí se zpožděním/)).toBeInTheDocument();
  });

  it('nejisté odeslání je samostatná kategorie, ne mezi selháními', () => {
    renderWithProviders(<ProgressScreen progress={{ ...progress, ambiguous_count: 3 }} />);
    expect(screen.getByTestId('tile-ambiguous')).toHaveTextContent('Nejisté odeslání');
  });

  it('nulové nejisté odeslání se neukazuje vůbec', () => {
    renderWithProviders(<ProgressScreen progress={progress} />);
    expect(screen.queryByTestId('tile-ambiguous')).toBeNull();
  });

  it.each([
    'render_failure_rate',
    'credentials_undecryptable',
    'provider_quota_exhausted',
    'provider_unavailable',
    'user',
    'bounce_guard',
    'complaint_guard',
    'provider_blocked',
    'materialize_timeout',
  ])('katalog pokrývá kód %s, takže pauza není nikdy bez důvodu', (code) => {
    renderWithProviders(<ProgressScreen progress={paused(code)} />);
    expect(screen.getByTestId('pause-box').textContent?.length).toBeGreaterThan(10);
  });

  it('u provider_quota_exhausted řekne, že kampaň pokračuje sama', () => {
    renderWithProviders(<ProgressScreen progress={paused('provider_quota_exhausted')} />);
    expect(screen.getByText(/bude automaticky pokračovat/)).toBeInTheDocument();
  });

  it('zastavení říká rovnou, že odeslané maily zpátky nejdou', () => {
    renderWithProviders(<ProgressScreen progress={paused('user')} />);
    expect(screen.getByText(/ty už zpátky nevezmeme/)).toBeInTheDocument();
  });

  it('při zaseklé rozesílce hlásí, že odesílání stojí', () => {
    renderWithProviders(<ProgressScreen progress={{ ...progress, stalled: true }} />);
    expect(screen.getByText(/Odesílání stojí/)).toBeInTheDocument();
  });

  it('pruh průběhu má roli progressbar s aria hodnotami', () => {
    renderWithProviders(<ProgressScreen progress={progress} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '428');
    expect(bar).toHaveAttribute('aria-valuemax', '1129');
  });

  it('během odesílání říká nahlas, že převzatá dávka doběhne', () => {
    renderWithProviders(
      <ProgressScreen progress={progress} onPause={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByText(/Zprávy, které si odesílací proces už převzal, dojdou/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zrušit zbytek rozesílky' })).toBeInTheDocument();
  });
});
