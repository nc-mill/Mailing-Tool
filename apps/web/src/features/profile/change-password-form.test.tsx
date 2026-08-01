// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { ChangePasswordFormView } from './change-password-form';

// Modul akcí se dotýká `server-only` a cookies, které v jsdom nejsou.
// Pohled si akci bere propem, takže stačí prázdná náhrada.
vi.mock('./actions', () => ({ changePasswordAction: vi.fn() }));

const messages = { settings: csSettings };

function renderForm(initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ChangePasswordFormView action={vi.fn()} initialState={initialState} />
    </NextIntlClientProvider>,
  );
}

describe('ChangePasswordFormView', () => {
  it('upozorní předem na odhlášení ostatních zařízení', () => {
    renderForm();
    expect(screen.getByText(/odhlásíme ze všech ostatních zařízení/)).toBeInTheDocument();
    expect(screen.getByText(/Tahle karta zůstane přihlášená/)).toBeInTheDocument();
  });

  it('má dvě pole hesel se správnými hodnotami autocomplete', () => {
    renderForm();
    expect(screen.getByLabelText('Současné heslo')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByLabelText('Nové heslo')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('po úspěchu ukáže inline blok, ne toast', () => {
    renderForm({
      status: 'success',
      channel: 'inlineBlock',
      messageKey: 'profile.password.doneTitle',
    });
    expect(screen.getByText('Heslo je změněné')).toBeInTheDocument();
    expect(screen.getByText(/Ostatní relace jsme ukončili/)).toBeInTheDocument();
  });

  it('u špatného současného hesla označí to pole, ne obě', () => {
    renderForm({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/auth/change-password',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [{ path: 'current_password', code: 'invalid', message: 'Současné heslo nesedí.' }],
      },
      fieldErrors: { current_password: ['Současné heslo nesedí.'] },
    });
    expect(screen.getByLabelText('Současné heslo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Nové heslo')).not.toHaveAttribute('aria-invalid');
  });

  it('primární tlačítko nemá disabled', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Změnit heslo' })).not.toHaveAttribute('disabled');
  });
});
