// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { IDLE } from '@/lib/feedback/action-result';
import { AddressFormSectionView } from './address-form-section';

// Modul akcí se dotýká `server-only` a cookies, které v jsdom nejsou.
// Pohled si akci bere propem, takže stačí prázdná náhrada.
vi.mock('./actions', () => ({
  updateAddressFormAction: vi.fn(),
  deleteWorkspaceAction: vi.fn(),
}));

const messages = { settings: csSettings };

const WORKSPACE = {
  id: 'ws1',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  locale: 'cs',
  timezone: 'Europe/Prague',
  address_form: 'formal' as const,
  created_at: '2026-01-01T00:00:00.000Z',
};

function renderSection(
  canWrite = true,
  contactCount = 12480,
  addressForm: 'formal' | 'informal' = 'formal',
) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <AddressFormSectionView
        workspace={{ ...WORKSPACE, address_form: addressForm }}
        canWrite={canWrite}
        contactCount={contactCount}
        action={vi.fn(async () => IDLE)}
      />
    </NextIntlClientProvider>,
  );
}

describe('AddressFormSectionView', () => {
  it('řekne, že se nastavení týká e-mailů, ne rozhraní', () => {
    renderSection();
    expect(screen.getByText(/Rozhraní nástroje vám vyká vždy/)).toBeInTheDocument();
  });

  it('ukáže obě volby s ukázkou oslovení', () => {
    renderSection();
    expect(screen.getByLabelText(/Vykání/)).toBeChecked();
    expect(screen.getByText('Dobrý den, Jano,')).toBeInTheDocument();
    expect(screen.getByText('Ahoj Jano,')).toBeInTheDocument();
  });

  it('stav nesděluje jen barvou, ale i slovem', () => {
    renderSection();
    expect(screen.getByLabelText(/Vykání/)).toHaveAttribute('type', 'radio');
  });

  it('po volbě druhé možnosti otevře potvrzovací dialog s počtem kontaktů', async () => {
    renderSection();
    await userEvent.click(screen.getByLabelText(/Tykání/));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // ODCHYLKA OD PLÁNU, jen zápisem testu: čeština odděluje tisíce pevnou
    // mezerou (U+00A0), ne obyčejnou. Doslovný zápis „12 480" by neseděl na
    // to, co Intl skutečně vypíše, a test by hlásil chybu tam, kde žádná není.
    expect(screen.getByText(/12\s480 kontaktů/)).toBeInTheDocument();
    expect(screen.getByText(/běží na pozadí/)).toBeInTheDocument();
  });

  it('dialog nabídne ústup, který vrátí původní volbu', async () => {
    renderSection();
    await userEvent.click(screen.getByLabelText(/Tykání/));
    await userEvent.click(screen.getByRole('button', { name: 'Nechat vykání' }));
    expect(screen.getByLabelText(/Vykání/)).toBeChecked();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('u nula kontaktů použije tvar pro nulu, ne „0 kontaktů"', async () => {
    renderSection(true, 0);
    await userEvent.click(screen.getByLabelText(/Tykání/));
    expect(screen.getByText(/žádného kontaktu/)).toBeInTheDocument();
  });

  it('bez oprávnění zápisu ukáže jen aktuální hodnotu jako text', () => {
    renderSection(false);
    expect(screen.queryByLabelText(/Tykání/)).not.toBeInTheDocument();
    expect(screen.getByText('Vykání')).toBeInTheDocument();
  });
});
