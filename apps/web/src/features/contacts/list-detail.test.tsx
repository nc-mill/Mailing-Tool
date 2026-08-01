import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListDetail, type ListDetailData } from './list-detail';
import { renderWithProviders } from './test-utils';

const setMode = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./actions', () => ({
  setConfirmationModeAction: (...args: unknown[]) => setMode(...args),
  archiveListAction: vi.fn().mockResolvedValue({ status: 'success' }),
}));

const list: ListDetailData = {
  id: 'l-1',
  name: 'Newsletter',
  confirmed_count: 12480,
  pending_count: 312,
  double_opt_in: true,
  confirmation_mode: 'one_step',
  archived: false,
};

function renderDetail(overrides: Partial<ListDetailData> = {}) {
  return renderWithProviders(
    <ListDetail basePath="/w/eshop/lists" list={{ ...list, ...overrides }} />,
  );
}

beforeEach(() => {
  setMode.mockClear();
});

describe('ListDetail', () => {
  it('ukáže počet potvrzených i čekajících, protože obojí nese rozhodnutí', () => {
    const counts = () => screen.getByTestId('list-counts').textContent!;
    renderDetail();
    expect(counts()).toMatch(/12\s480 potvrzených kontaktů/);
    expect(counts()).toMatch(/312 čeká na potvrzení/);
  });

  it('u obou režimů potvrzení vysvětlí rozdíl větou, ne jen názvem', () => {
    renderDetail();
    expect(screen.getByText(/Potvrzení odešle stránka za něj/)).toBeInTheDocument();
    expect(screen.getByText(/Je to o klik navíc, zato máte doložené/)).toBeInTheDocument();
  });

  it('nepoužívá slova jednokrokové a dvoukrokové jako jediné vysvětlení', () => {
    renderDetail();
    expect(screen.getByRole('radio', { name: 'Jedním kliknutím' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' }),
    ).toBeInTheDocument();
  });

  it('vybraný režim odpovídá datům', () => {
    renderDetail({ confirmation_mode: 'two_step' });
    expect(screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' })).toBeChecked();
  });

  it('přepnutí režimu uloží a řekne, od kdy platí', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('radio', { name: 'Kliknutím a potvrzením na stránce' }));
    expect(setMode).toHaveBeenCalledWith({ id: 'l-1', mode: 'two_step' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Platí pro potvrzovací e-maily odeslané od teď.',
    );
  });
});
