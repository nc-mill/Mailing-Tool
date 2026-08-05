// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { IDLE } from '@/lib/feedback/action-result';
import { DangerZoneView } from './danger-zone';

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

function renderZone() {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <DangerZoneView workspace={WORKSPACE} action={vi.fn(async () => IDLE)} />
    </NextIntlClientProvider>,
  );
}

describe('DangerZoneView', () => {
  it('použije doslovný text z 5.3 části 1', () => {
    renderZone();
    expect(
      screen.getByText(
        'Smazání odstraní všechny kontakty, kampaně i statistiky. Obnovit to jde 30 dní. Pro potvrzení opište název projektu.',
      ),
    ).toBeInTheDocument();
  });

  it('destruktivní tlačítko je vidět a je barevně odlišené, ne schované v nabídce', () => {
    renderZone();
    const button = screen.getByRole('button', { name: 'Smazat projekt' });
    expect(button).toHaveAttribute('data-variant', 'danger');
  });

  it('dialog vyjmenuje následky a připomene třicetidenní okno', async () => {
    renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText(/Zmizí všechny kontakty, seznamy, segmenty a štítky/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Klíče k API a webhooky projektu okamžitě přestanou fungovat/),
    ).toBeInTheDocument();
    expect(screen.getByText(/obnovit 30 dní/)).toBeInTheDocument();
  });

  it('vyžaduje opsání názvu projektu', async () => {
    renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(screen.getByLabelText('Pro potvrzení opište název projektu')).toBeInTheDocument();
  });

  it('název v tlačítku i v nadpisu dialogu je konkrétní', async () => {
    renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(
      screen.getByRole('heading', { name: 'Smazat projekt E-shop Kolo?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Smazat projekt E-shop Kolo' })).toBeInTheDocument();
  });

  it('tlačítko ústupu je vlevo a je pojmenované slovesem, ne slovem Ne', async () => {
    renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(screen.getByRole('button', { name: 'Nechat projekt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ne' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  });

  it('opsaný název jde do těla požadavku jako confirm_name', async () => {
    const { container } = renderZone();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    await userEvent.type(
      screen.getByLabelText('Pro potvrzení opište název projektu'),
      'E-shop Kolo',
    );
    // Napsaný text si drží `ConfirmDialog` (viz odchylka v `danger-zone.tsx`)
    // a odeslání pustí jedině při přesné shodě s názvem projektu. V těle
    // požadavku je proto název, tedy přesně to, co uživatel opsal.
    expect(screen.getByLabelText('Pro potvrzení opište název projektu')).toHaveValue('E-shop Kolo');
    expect(container.querySelector('input[name="confirm_name"]')).toHaveValue('E-shop Kolo');
  });
});
