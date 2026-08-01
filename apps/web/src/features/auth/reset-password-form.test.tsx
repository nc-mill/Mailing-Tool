// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { ResetPasswordForm } from './reset-password-form';

const messages = { auth: csAuth };

function renderForm(token: string | undefined, initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ResetPasswordForm action={vi.fn()} token={token} initialState={initialState} />
    </NextIntlClientProvider>,
  );
}

describe('ResetPasswordForm', () => {
  it('bez tokenu v adrese rovnou ukáže stav neplatného odkazu', () => {
    renderForm(undefined);
    expect(screen.getByText('Odkaz už neplatí')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vyžádat nový odkaz' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByLabelText('Nové heslo')).not.toBeInTheDocument();
  });

  it('s tokenem ukáže pole na nové heslo a upozorní na odhlášení ostatních relací', () => {
    renderForm('TOKEN');
    expect(screen.getByLabelText('Nové heslo')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByText(/odhlásíme ze všech ostatních zařízení/)).toBeInTheDocument();
  });

  it('token drží ve skrytém poli', () => {
    const { container } = renderForm('TOKEN');
    expect(container.querySelector('input[name="token"]')).toHaveValue('TOKEN');
  });

  it('u prošlého tokenu ukáže stav neplatného odkazu, ne obecnou chybu', () => {
    renderForm('TOKEN', {
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Unauthenticated',
        status: 401,
        detail: '',
        instance: '/api/v1/auth/password-reset/confirm',
        code: 'unauthenticated',
        request_id: 'req_1',
      },
      fieldErrors: {},
    });
    expect(screen.getByText('Odkaz už neplatí')).toBeInTheDocument();
  });

  it('po úspěchu ukáže hotovo a odkaz na přihlášení', () => {
    renderForm('TOKEN', {
      status: 'success',
      channel: 'inlineBlock',
      messageKey: 'reset.doneTitle',
    });
    expect(screen.getByText('Heslo je nastavené')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět na přihlášení' })).toBeInTheDocument();
  });

  it('krátké heslo ukáže u pole, ne jako celostránkovou chybu', () => {
    renderForm('TOKEN', {
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/auth/password-reset/confirm',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [
          { path: 'new_password', code: 'too_short', message: 'Heslo musí mít aspoň 12 znaků.' },
        ],
      },
      fieldErrors: { new_password: ['Heslo musí mít aspoň 12 znaků.'] },
    });
    expect(screen.getByLabelText('Nové heslo')).toHaveAttribute('aria-invalid', 'true');
  });
});
