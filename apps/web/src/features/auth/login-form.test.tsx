// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { LoginForm } from './login-form';

const messages = { auth: csAuth };

function problemState(
  code: string,
  status: number,
  extra: Record<string, unknown> = {},
): ActionState {
  return {
    status: 'error',
    channel: 'inlineBlock',
    problem: {
      type: '',
      title: code,
      status,
      detail: '',
      instance: '/api/v1/auth/login',
      code,
      request_id: 'req_1',
      ...extra,
    },
    fieldErrors: {},
  };
}

function renderForm(initialState?: ActionState, next?: string) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <LoginForm action={vi.fn()} next={next} initialState={initialState} />
    </NextIntlClientProvider>,
  );
}

describe('LoginForm', () => {
  it('má pole e-mail a heslo a odkaz na zapomenuté heslo', () => {
    renderForm();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Heslo')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Zapomněli jste heslo?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('u chybných údajů ukáže hlášku, která nepotvrzuje existenci účtu', () => {
    renderForm(problemState('invalid_credentials', 401));
    expect(screen.getByText('E-mail nebo heslo nesedí')).toBeInTheDocument();
    expect(screen.queryByText(/účet neexistuje/i)).not.toBeInTheDocument();
  });

  it('u zamčeného účtu vysvětlí patnáctiminutové okno', () => {
    renderForm(problemState('account_locked', 423, { retry_after: 900 }));
    expect(screen.getByText('Účet jsme dočasně zamkli')).toBeInTheDocument();
    expect(screen.getByText(/15 minut/)).toBeInTheDocument();
  });

  it('u rate limitu doplní počet sekund do hlášky', () => {
    renderForm(problemState('rate_limited', 429, { retry_after: 37 }));
    expect(screen.getByText('Zkoušíte to příliš často')).toBeInTheDocument();
    expect(screen.getByText(/37 sekund/)).toBeInTheDocument();
  });

  it('nese cílovou adresu v skrytém poli', () => {
    const { container } = renderForm(undefined, '/w/eshop/settings/members');
    const hidden = container.querySelector('input[name="next"]');
    expect(hidden).toHaveValue('/w/eshop/settings/members');
  });

  it('chybový blok drží kód v data-error-code', () => {
    const { container } = renderForm(problemState('invalid_credentials', 401));
    expect(container.querySelector('[data-error-code="invalid_credentials"]')).not.toBeNull();
  });

  it('u neznámého kódu ukáže detail ze serveru, ne prázdno', async () => {
    renderForm({
      status: 'error',
      channel: 'inlineBlock',
      problem: {
        type: '',
        title: 'Weird',
        status: 400,
        detail: 'Něco divného ze serveru.',
        instance: '/api/v1/auth/login',
        code: 'some_future_code',
        request_id: 'req_x',
      },
      fieldErrors: {},
    });
    expect(screen.getByText('Něco divného ze serveru.')).toBeInTheDocument();
    // ODCHYLKA OD PLÁNU, vynucená komponentou P05: `Collapsible` stojí na Radixu
    // a sbalený obsah v dokumentu vůbec není, takže číslo požadavku je vidět
    // až po rozbalení. Chování odpovídá kritériu 22 části 6 (technické detaily
    // jsou sbalené), jen se v testu musí kliknout.
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('req_x')).toBeInTheDocument();
  });
});
