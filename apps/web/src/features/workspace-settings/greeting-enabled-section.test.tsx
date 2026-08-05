// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import { IDLE, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { GreetingEnabledSectionView } from './greeting-enabled-section';

// Modul akcí se dotýká `server-only` a cookies, které v jsdom nejsou.
vi.mock('./actions', () => ({
  updateGreetingEnabledAction: vi.fn(),
}));

const messages = { settings: csSettings };

const WORKSPACE = {
  id: 'ws1',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  locale: 'cs',
  timezone: 'Europe/Prague',
  address_form: 'formal' as const,
  greeting_enabled: true,
  created_at: '2026-01-01T00:00:00.000Z',
};

function renderSection(
  greetingEnabled: boolean,
  action: (previous: ActionState, formData: FormData) => Promise<ActionState> = vi.fn(
    async () => IDLE,
  ),
  canWrite = true,
) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <GreetingEnabledSectionView
        workspace={{ ...WORKSPACE, greeting_enabled: greetingEnabled }}
        canWrite={canWrite}
        action={action}
      />
    </NextIntlClientProvider>,
  );
}

describe('vypínač oslovení a 5. pádu', () => {
  it('ukazuje zapnutý stav i s vysvětlením, co je vidět', () => {
    renderSection(true);
    expect(screen.getByTestId('greeting-enabled-switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Projekt řeší oslovení/)).toBeInTheDocument();
  });

  /**
   * Věta u vypnutého stavu MUSÍ slíbit, že se nic nemaže. Je to jediné místo,
   * kde se uživatel dozví, že přepnutí je vratné, a bez toho by přepínač vypadal
   * jako destruktivní akce, kterou nikdo nezkusí.
   */
  it('u vypnutého stavu slíbí, že se nic neztratí', () => {
    renderSection(false);
    expect(screen.getByTestId('greeting-enabled-switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Nic se nemaže/)).toBeInTheDocument();
  });

  it('pošle novou hodnotu serverové akci', async () => {
    const action = vi.fn(
      async (_previous: ActionState, _formData: FormData): Promise<ActionState> =>
        succeeded({ channel: 'page', messageKey: 'shared.saved' }),
    );
    renderSection(true, action);
    await userEvent.click(screen.getByTestId('greeting-enabled-switch'));
    expect(action).toHaveBeenCalledTimes(1);
    const formData = action.mock.calls[0]![1];
    expect(formData.get('workspace_id')).toBe('ws1');
    expect(formData.get('greeting_enabled')).toBe('false');
  });

  /**
   * Odmítnutou hodnotu přepínač dál ukazovat nesmí. Bez tohohle vrácení by
   * uživatel viděl vypnuto, zatímco projekt by měl dál zapnuto, a rozhraní by
   * tvrdilo něco, co v databázi neplatí.
   */
  it('po chybě serveru se vrátí na původní polohu', async () => {
    const action = vi.fn(async (): Promise<ActionState> => ({
      status: 'error',
      channel: 'page',
      problem: {
        type: 'x',
        title: 'Nope',
        status: 403,
        detail: '',
        instance: '/api/v1/workspaces',
        code: 'forbidden',
        request_id: '',
      },
      fieldErrors: {},
    }));
    renderSection(true, action);
    await userEvent.click(screen.getByTestId('greeting-enabled-switch'));
    expect(await screen.findByTestId('greeting-enabled-switch')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('bez oprávnění je přepínač jen ke čtení', () => {
    renderSection(
      true,
      vi.fn(async () => IDLE),
      false,
    );
    expect(screen.getByTestId('greeting-enabled-switch')).toBeDisabled();
  });
});
