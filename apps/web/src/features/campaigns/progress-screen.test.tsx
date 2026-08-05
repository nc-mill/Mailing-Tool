import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProgressScreen, type CampaignProgress } from './progress-screen';
import { UndoCountdown } from './undo-countdown';
import { renderWithProviders, withProviders } from './test-utils';

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
  // Kampaň, u které doručenost MĚŘÍME: od poskytovatele něco dorazilo.
  delivery_events_seen: true,
  finished: false,
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

  it('Odeslat teď stojí vedle Vzít zpět, ne schované jinde', () => {
    renderWithProviders(
      <UndoCountdown remainingSeconds={40} onUndo={vi.fn()} onSendNow={vi.fn()} />,
    );
    const row = screen.getByTestId('undo-countdown');
    expect(row).toHaveTextContent('Vzít zpět');
    expect(row).toHaveTextContent('Odeslat teď');
  });

  it('u Odeslat teď je rovnou napsané, že zpátky to nepůjde', () => {
    renderWithProviders(
      <UndoCountdown remainingSeconds={40} onUndo={vi.fn()} onSendNow={vi.fn()} />,
    );
    expect(screen.getByText(/zpátky už nepůjde/)).toBeInTheDocument();
  });

  it('bez obsluhy se Odeslat teď vůbec nenabízí', () => {
    renderWithProviders(<UndoCountdown remainingSeconds={40} onUndo={vi.fn()} />);
    expect(screen.queryByTestId('send-now')).toBeNull();
  });

  it('po stisku Odeslat teď zmizí odpočet a je vidět, že se spouští', async () => {
    const onSendNow = vi.fn();
    const { rerender } = renderWithProviders(
      <UndoCountdown remainingSeconds={40} onUndo={vi.fn()} onSendNow={onSendNow} />,
    );
    await userEvent.click(screen.getByTestId('send-now'));
    expect(onSendNow).toHaveBeenCalledTimes(1);

    // Stav drží obrazovka průběhu, takže se sem vrací propem. Podstatné je, co
    // uživatel uvidí: odpočet je pryč a na jeho místě je hláška o spouštění.
    rerender(
      withProviders(
        <UndoCountdown remainingSeconds={40} onUndo={vi.fn()} onSendNow={onSendNow} releasing />,
      ),
    );
    expect(screen.getByText('Spouštíme rozesílku…')).toBeInTheDocument();
    expect(screen.queryByText(/Odesíláme za/)).toBeNull();
  });

  it('při spouštění je ukazatel NEURČITÝ, nepředstírá procenta', () => {
    renderWithProviders(
      <UndoCountdown remainingSeconds={40} onUndo={vi.fn()} onSendNow={vi.fn()} releasing />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
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

  /*
   * Nula a „neměříme" jsou dvě různé věci. Ve vývoji nedorazí od poskytovatele
   * ani jedna událost (odběr u Amazonu se nepotvrdí, protože náš webhook běží
   * na localhost), takže trvalá nula u Doručeno by tvrdila, že nikomu nic
   * nedošlo. Obrazovka to musí říct.
   */
  it('bez událostí od poskytovatele neukazuje u Doručeno nulu', () => {
    renderWithProviders(
      <ProgressScreen
        progress={{
          ...progress,
          delivery_events_seen: false,
          counters: { ...progress.counters, delivered: 0, bounced: 0 },
        }}
      />,
    );
    expect(screen.getByTestId('tile-delivered')).toHaveTextContent('Zatím nevíme');
    expect(screen.getByTestId('tile-bounced')).toHaveTextContent('Zatím nevíme');
    expect(screen.getByTestId('tile-delivered')).not.toHaveTextContent('0');
  });

  it('chybějící příznak z API se bere jako neměříme, ne jako nula', () => {
    const withoutFlag: CampaignProgress = { ...progress };
    delete withoutFlag.delivery_events_seen;
    renderWithProviders(<ProgressScreen progress={withoutFlag} />);
    expect(screen.getByTestId('tile-delivered')).toHaveTextContent('Zatím nevíme');
  });

  it('s událostmi od poskytovatele ukazuje skutečná čísla', () => {
    renderWithProviders(<ProgressScreen progress={progress} />);
    expect(screen.getByTestId('tile-delivered')).toHaveTextContent('421');
  });

  it('počet odeslaných je vidět i jako text, ne jen v atributu pruhu', () => {
    renderWithProviders(<ProgressScreen progress={progress} />);
    expect(screen.getByTestId('progress-caption').textContent).toContain('Odesláno 428 z 1');
  });

  it('při stavbě publika je ukazatel neurčitý, ne nula procent', () => {
    renderWithProviders(
      <ProgressScreen
        progress={{
          ...progress,
          status: 'queueing',
          counters: { ...progress.counters, total: 0, sent: 0, pending: 0 },
        }}
      />,
    );
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Připravujeme publikum…')).toBeInTheDocument();
  });

  it('odkaz na report je za běhu nenápadný a po dojetí z něj je pruh', () => {
    renderWithProviders(
      <ProgressScreen progress={progress} reportHref="/w/a/campaigns/k1/report" />,
    );
    expect(screen.getByTestId('progress-to-report').tagName).toBe('A');

    renderWithProviders(
      <ProgressScreen
        progress={{ ...progress, status: 'sent' }}
        reportHref="/w/a/campaigns/k1/report"
      />,
    );
    expect(screen.getAllByText(/Rozesílka skončila/)[0]).toBeInTheDocument();
  });

  it('selhání akce se přizná, netlumí se', () => {
    renderWithProviders(<ProgressScreen progress={progress} actionFailed />);
    expect(screen.getByText(/Akci se nepodařilo provést/)).toBeInTheDocument();
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
