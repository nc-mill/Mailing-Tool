// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { ForgotPasswordForm } from './forgot-password-form';

const messages = { auth: csAuth };

function renderForm(initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ForgotPasswordForm action={vi.fn()} initialState={initialState} />
    </NextIntlClientProvider>,
  );
}

describe('ForgotPasswordForm', () => {
  it('má pole e-mail a vysvětlí platnost odkazu', () => {
    renderForm();
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByText(/60 minut/)).toBeInTheDocument();
  });

  it('po odeslání ukáže stejnou hlášku bez ohledu na existenci účtu', () => {
    renderForm({ status: 'success', channel: 'inlineBlock', messageKey: 'forgot.sentTitle' });
    expect(screen.getByText('Odkaz je na cestě')).toBeInTheDocument();
    expect(screen.getByText(/Odpověď je stejná i pro adresu, kterou neznáme/)).toBeInTheDocument();
  });

  it('po odeslání formulář zmizí, aby nešlo klikat dokola', () => {
    renderForm({ status: 'success', channel: 'inlineBlock', messageKey: 'forgot.sentTitle' });
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
  });

  it('má odkaz zpět na přihlášení', () => {
    renderForm();
    expect(screen.getByRole('link', { name: 'Zpět na přihlášení' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('u rate limitu ukáže hlášku s počtem sekund', () => {
    renderForm({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Rate limit exceeded',
        status: 429,
        detail: '',
        instance: '/api/v1/auth/password-reset',
        code: 'rate_limited',
        request_id: 'req_1',
        retry_after: 120,
      },
      fieldErrors: {},
    });
    expect(screen.getByText(/120 sekund/)).toBeInTheDocument();
  });
});
