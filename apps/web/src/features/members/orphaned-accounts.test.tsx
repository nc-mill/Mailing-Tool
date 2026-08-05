// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@mlain/ui/patterns/toast';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { Result } from '@/lib/api-client/result';
import { OrphanedAccounts, type OrphanedAccountRow } from './orphaned-accounts';

// Modul akcí se dotýká `server-only` a cookies, které v jsdom nejsou.
vi.mock('./actions', () => ({ deleteUserAccountAction: vi.fn() }));

const messages = { settings: csSettings };

// `useToast` z P05 mimo `ToastProvider` vyhodí výjimku, takže pohled potřebuje
// obal. Popisky jsou testovací, obrazovka si je bere z katalogu ve skořápce.
const TOAST_LABELS = {
  undo: 'Vrátit zpět',
  close: 'Zavřít',
  notifications: 'Oznámení',
  countdown: (seconds: number) => `${seconds} s`,
  repeated: (message: string, count: number) => `${message} (${count})`,
};

const ROWS: OrphanedAccountRow[] = [
  {
    user_id: '11111111-1111-4111-8111-111111111111',
    email: 'byvaly@firma.cz',
    name: 'Bývalý Kolega',
    created_at: '2026-07-01T10:00:00.000Z',
    last_login_at: null,
  },
];

function renderSection(accounts: Result<{ data: OrphanedAccountRow[] }>) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ToastProvider labels={TOAST_LABELS}>
        <OrphanedAccounts accounts={accounts} workspaceId="ws1" slug="eshop" action={vi.fn()} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe('OrphanedAccounts', () => {
  /**
   * Jádro opravy: účet po odebrání z projektu nikde nebyl vidět, přestože se
   * pořád přihlásí. Tahle sekce je jediné místo, kde na něj jde narazit.
   */
  it('vypíše účet bez projektu i s tím, že se nikdy nepřihlásil', () => {
    renderSection({ ok: true, data: { data: ROWS } });
    expect(screen.getByText('byvaly@firma.cz')).toBeInTheDocument();
    expect(screen.getByText('Bývalý Kolega')).toBeInTheDocument();
    expect(screen.getByText('Nikdy')).toBeInTheDocument();
  });

  it('prázdný stav řekne, že žádný takový účet není', () => {
    renderSection({ ok: true, data: { data: [] } });
    expect(
      screen.getByText(/Každý účet v instalaci patří aspoň do jednoho projektu/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Smazat účet' })).not.toBeInTheDocument();
  });

  it('smazání se ptá a vyjmenuje následky včetně toho, že audit zůstává', async () => {
    renderSection({ ok: true, data: { data: ROWS } });
    await userEvent.click(screen.getByRole('button', { name: 'Smazat účet' }));

    expect(screen.getByText('Smazat účet byvaly@firma.cz?')).toBeInTheDocument();
    expect(screen.getByText(/otevřené relace skončí okamžitě/)).toBeInTheDocument();
    expect(screen.getByText(/Záznamy v auditu zůstávají/)).toBeInTheDocument();
    expect(screen.getByText(/adresa je hned volná/)).toBeInTheDocument();
  });

  it('chybu výpisu ukáže, místo aby předstírala prázdný seznam', () => {
    renderSection({
      ok: false,
      problem: {
        type: '',
        title: 'Forbidden',
        status: 403,
        detail: '',
        instance: '/api/v1/users/orphaned',
        code: 'forbidden',
        request_id: 'req_31',
      },
    });
    expect(screen.queryByText(/Každý účet v instalaci patří/)).not.toBeInTheDocument();
  });
});
