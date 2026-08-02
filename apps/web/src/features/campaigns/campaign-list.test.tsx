import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CampaignList, type CampaignRow } from './campaign-list';
import { StatusBadge } from './status-badge';
import { renderWithProviders } from './test-utils';

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const rows: CampaignRow[] = [
  {
    id: 'k1',
    name: 'Letní výprodej',
    status: 'sending',
    audience_size: 1129,
    counters: { total: 1129, sent: 428, delivered: 421, bounced: 6 },
    updated_at: '2026-08-01T12:38:00.000Z',
  },
];

describe('seznam kampaní', () => {
  it('prázdný stav vysvětluje a nabízí akci', () => {
    renderWithProviders(<CampaignList rows={[]} state="empty" onCreate={vi.fn()} />);
    expect(screen.getByText('Zatím žádné kampaně')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vytvořit kampaň' })).toBeInTheDocument();
  });

  it('stav načítání ukazuje kostru pěti řádků, ne kolečko', () => {
    renderWithProviders(<CampaignList rows={[]} state="loading" />);
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
  });

  it('chybový stav nabízí Zkusit znovu', () => {
    renderWithProviders(<CampaignList rows={[]} state="error" onRetry={vi.fn()} />);
    expect(screen.getByText('Kampaně se nepodařilo načíst.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('tabulka ukazuje název, stav i počet příjemců', () => {
    renderWithProviders(<CampaignList rows={rows} state="data" />);
    expect(screen.getByText('Letní výprodej')).toBeInTheDocument();
    expect(screen.getByText('Odesílá se')).toBeInTheDocument();
    expect(screen.getByText('1 129 příjemců')).toBeInTheDocument();
  });
});

describe('štítek stavu', () => {
  it.each([
    ['draft', 'Rozepsaná'],
    ['sending', 'Odesílá se'],
    ['partially_sent', 'Odeslaná částečně'],
    ['schedule_missed', 'Plán propásnut'],
  ])('stav %s je %s', (status, label) => {
    renderWithProviders(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('neznámý stav se zobrazí neutrálně, komponenta nespadne', () => {
    renderWithProviders(<StatusBadge status="ab_testing" />);
    expect(screen.getByText('ab_testing')).toBeInTheDocument();
  });

  it('běžící stav má aria-live, aby ho přečetla čtečka', () => {
    renderWithProviders(<StatusBadge status="sending" />);
    expect(screen.getByText('Odesílá se').closest('[aria-live]')).not.toBeNull();
  });
});
