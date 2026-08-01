// Matchery jest-dom se typují modulovou augmentací. Registruje je
// `apps/web/vitest.setup.ts`, jenže ten soubor v `tsconfig.json` není
// v `include`, takže `tsc` augmentaci nevidí. Import tady je typová oprava
// bez dopadu na chování: modul se stejně načítá v setupu.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import { SetupForm } from './setup-form';

const messages = { auth: csAuth };

function renderForm(action = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <SetupForm action={action} locales={['cs', 'en']} />
    </NextIntlClientProvider>,
  );
}

describe('SetupForm', () => {
  it('má všechna povinná pole s viditelnými popisky', () => {
    renderForm();
    expect(screen.getByLabelText('Jméno a příjmení')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Heslo')).toBeInTheDocument();
    expect(screen.getByLabelText('Název projektu')).toBeInTheDocument();
    expect(screen.getByLabelText('Jazyk rozhraní')).toBeInTheDocument();
  });

  it('primární tlačítko nemá disabled', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Založit účet a projekt' })).not.toHaveAttribute(
      'disabled',
    );
  });

  it('vysvětlí, co je projekt', () => {
    renderForm();
    expect(screen.getByText(/oddělený prostor s vlastními kontakty/)).toBeInTheDocument();
  });

  it('ukáže chyby polí z odpovědi serveru a označí pole jako neplatná', () => {
    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <SetupForm
          action={vi.fn()}
          locales={['cs', 'en']}
          initialState={{
            status: 'error',
            channel: 'inlineBlock',
            problem: {
              type: '',
              title: 'Validation failed',
              status: 422,
              detail: '',
              instance: '/api/v1/setup',
              code: 'validation_failed',
              request_id: 'req_1',
              errors: [
                { path: 'password', code: 'too_short', message: 'Heslo musí mít aspoň 12 znaků.' },
              ],
            },
            fieldErrors: { password: ['Heslo musí mít aspoň 12 znaků.'] },
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText('Heslo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Heslo musí mít aspoň 12 znaků.')).toBeInTheDocument();
  });

  it('u hotové instalace ukáže hlášku setup_already_completed s odkazem na přihlášení', () => {
    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <SetupForm
          action={vi.fn()}
          locales={['cs', 'en']}
          initialState={{
            status: 'error',
            channel: 'inlineBlock',
            problem: {
              type: '',
              title: 'Setup already completed',
              status: 409,
              detail: '',
              instance: '/api/v1/setup',
              code: 'setup_already_completed',
              request_id: 'req_2',
            },
            fieldErrors: {},
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Instalace už je nastavená')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět na přihlášení' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('nese skryté pole s klíčem idempotence', () => {
    const { container } = renderForm();
    expect(container.querySelector('input[name="_idempotency_key"]')).not.toBeNull();
  });
});
