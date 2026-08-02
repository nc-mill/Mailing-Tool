import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrialModePanel, type TrialView } from './trial-mode-panel';
import type { AddTrialAddressResult } from './actions';
import { renderWithProviders } from '../campaigns/test-utils';

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const base: TrialView = {
  trial_mode: true,
  trial_mode_explicit: null,
  verified: [],
  verified_count: 0,
  max_addresses: 10,
  has_verified_domain: false,
};

type Toggle = (enabled: boolean) => Promise<{ status: 'success' | 'error'; code?: string }>;
type AddAddress = (email: string) => Promise<AddTrialAddressResult>;

function renderPanel(
  override: Partial<TrialView> = {},
  handlers: { onToggle?: Toggle; onAddAddress?: AddAddress } = {},
) {
  const onToggle = vi.fn<Toggle>(
    handlers.onToggle ?? (async () => ({ status: 'success' as const })),
  );
  const onAddAddress = vi.fn<AddAddress>(
    handlers.onAddAddress ?? (async () => ({ status: 'success' as const, verificationUrl: null })),
  );
  renderWithProviders(
    <TrialModePanel
      trial={{ ...base, ...override }}
      onToggle={onToggle}
      onAddAddress={onAddAddress}
    />,
  );
  return { onToggle, onAddAddress };
}

describe('ovládání zkušebního režimu', () => {
  it('tlačítko na přidání adresy je na obrazovce i v prázdném stavu', () => {
    renderPanel();
    // Doslovný název hlídá i zlatá cesta, proto se testuje přesně on.
    expect(screen.getByRole('button', { name: 'Přidat ověřenou adresu' })).toBeInTheDocument();
  });

  it('seznam rozlišuje potvrzenou adresu od té, která na potvrzení čeká', () => {
    renderPanel({
      verified: [
        { email: 'overena@firma.cz', verified_at: '2026-08-01T10:00:00.000Z' },
        { email: 'ceka@firma.cz', verified_at: null },
      ],
      verified_count: 1,
    });
    const list = screen.getByTestId('trial-address-list');
    expect(list).toHaveTextContent('overena@firma.cz');
    expect(list).toHaveTextContent('Ověřeno');
    expect(list).toHaveTextContent('ceka@firma.cz');
    expect(list).toHaveTextContent('Čeká na potvrzení');
  });

  it('přidání adresy pošle na server malá písmena a ohlásí, kam odkaz odešel', async () => {
    const user = userEvent.setup();
    const { onAddAddress } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Přidat ověřenou adresu' }));
    await user.type(screen.getByTestId('trial-email'), 'Overena@Firma.cz');
    await user.click(screen.getByRole('button', { name: 'Odeslat potvrzení' }));

    expect(onAddAddress).toHaveBeenCalledWith('Overena@Firma.cz');
    expect(screen.getByTestId('trial-address-sent')).toHaveTextContent('Overena@Firma.cz');
  });

  it('mimo produkci ukáže i odkaz, protože bez odesílání by režim nešlo dokončit', async () => {
    const user = userEvent.setup();
    renderPanel(
      {},
      {
        onAddAddress: async () => ({
          status: 'success' as const,
          verificationUrl: 'http://localhost:3100/verify-sender/v1.abc',
        }),
      },
    );

    await user.click(screen.getByRole('button', { name: 'Přidat ověřenou adresu' }));
    await user.type(screen.getByTestId('trial-email'), 'overena@firma.cz');
    await user.click(screen.getByRole('button', { name: 'Odeslat potvrzení' }));

    expect(screen.getByTestId('trial-verification-link')).toHaveAttribute(
      'href',
      'http://localhost:3100/verify-sender/v1.abc',
    );
  });

  it('neplatná adresa se na server vůbec nepošle', async () => {
    const user = userEvent.setup();
    const { onAddAddress } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Přidat ověřenou adresu' }));
    await user.type(screen.getByTestId('trial-email'), 'tohle-neni-adresa');
    await user.click(screen.getByRole('button', { name: 'Odeslat potvrzení' }));

    expect(onAddAddress).not.toHaveBeenCalled();
    expect(screen.getByText('Zadejte platnou e-mailovou adresu.')).toBeInTheDocument();
  });

  it('na stropu deseti adres se další přidat nedá a je řečeno proč', () => {
    renderPanel({
      verified: Array.from({ length: 10 }, (_, i) => ({
        email: `adresa${i}@firma.cz`,
        verified_at: null,
      })),
    });
    expect(screen.getByTestId('trial-add-address')).toBeDisabled();
    expect(
      screen.getByText('Ve zkušebním režimu lze ověřit nejvýše 10 adres.'),
    ).toBeInTheDocument();
  });

  it('zapnutý režim nabízí vypnutí a odmítnutí serveru se ohlásí', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderPanel(
      { trial_mode: true },
      { onToggle: async () => ({ status: 'error' as const, code: 'forbidden' }) },
    );

    await user.click(screen.getByRole('button', { name: 'Vypnout zkušební režim' }));

    expect(onToggle).toHaveBeenCalledWith(false);
    expect(screen.getByText('Zkušební režim se nepodařilo přepnout.')).toBeInTheDocument();
  });

  it('s ověřenou doménou tlačítko rovnou říká, že už režim není potřeba', () => {
    renderPanel({ trial_mode: true, has_verified_domain: true });
    expect(
      screen.getByRole('button', { name: 'Doména je ověřená. Vypnout zkušební režim' }),
    ).toBeInTheDocument();
  });

  it('vypnutý režim nabízí zapnutí', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderPanel({ trial_mode: false });
    await user.click(screen.getByRole('button', { name: 'Zapnout zkušební režim' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
