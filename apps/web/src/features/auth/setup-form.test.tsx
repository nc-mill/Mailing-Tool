// Matchery jest-dom se typují modulovou augmentací. Registruje je
// `apps/web/vitest.setup.ts`, jenže ten soubor v `tsconfig.json` není
// v `include`, takže `tsc` augmentaci nevidí. Import tady je typová oprava
// bez dopadu na chování: modul se stejně načítá v setupu.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAuth from '../../../../../packages/i18n/messages/cs/auth.json';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
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

  /**
   * Stav konfigurace je VAROVÁNÍ, ne brána. Instalaci musí jít dokončit
   * i tehdy, když v konfiguraci něco chybí, jinak by se člověk s neúplným
   * `.env` nedostal do aplikace vůbec a neměl by kde chybu opravit.
   */
  it('formulář jde odeslat i s panelem, který hlásí chybějící konfiguraci', async () => {
    const action = vi.fn(async (): Promise<ActionState> => IDLE);
    render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <SetupForm
          action={action}
          locales={['cs', 'en']}
          configStatus={<p>Chybí DATABASE_URL_MAINTENANCE</p>}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('Chybí DATABASE_URL_MAINTENANCE')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Založit účet a projekt' });
    expect(submit).not.toHaveAttribute('disabled');
    expect(submit).not.toHaveAttribute('aria-disabled');

    await userEvent.type(screen.getByLabelText('Jméno a příjmení'), 'Petr Novák');
    await userEvent.type(screen.getByLabelText('E-mail'), 'petr@example.com');
    await userEvent.type(screen.getByLabelText('Heslo'), 'dostatecne-dlouhe-heslo');
    await userEvent.type(screen.getByLabelText('Název projektu'), 'Eshop');
    await userEvent.click(submit);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('nese skryté pole s klíčem idempotence', () => {
    const { container } = renderForm();
    expect(container.querySelector('input[name="_idempotency_key"]')).not.toBeNull();
  });

  /**
   * Vada z čisté instalace: uživatel zadal krátké heslo, odeslal, a formulář
   * se vrátil prázdný. React 19 po doběhnutí akce neřízený formulář nuluje,
   * takže se vyplněné hodnoty musí vrátit z akce a nasadit přes `defaultValue`.
   */
  it('po chybě nechá ostatní pole vyplněná a heslo vyprázdní', async () => {
    const action = vi.fn(
      async (_previous: ActionState, formData: FormData): Promise<ActionState> => ({
        status: 'error',
        channel: 'inlineBlock',
        problem: {
          type: '',
          title: 'Validation failed',
          status: 422,
          detail: '',
          instance: '/api/v1/setup',
          code: 'validation_failed',
          request_id: 'req_3',
          errors: [
            {
              path: 'password',
              code: 'password_too_short',
              message: 'Heslo musí mít aspoň 12 znaků. Zadali jste 3 znaky.',
            },
          ],
        },
        fieldErrors: { password: ['Heslo musí mít aspoň 12 znaků. Zadali jste 3 znaky.'] },
        values: {
          name: String(formData.get('name') ?? ''),
          email: String(formData.get('email') ?? ''),
          workspace_name: String(formData.get('workspace_name') ?? ''),
          locale: String(formData.get('locale') ?? ''),
        },
      }),
    );

    const { container } = render(
      <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
        <SetupForm action={action} locales={['cs', 'en']} />
      </NextIntlClientProvider>,
    );

    await userEvent.type(screen.getByLabelText('Jméno a příjmení'), 'Petr Novák');
    await userEvent.type(screen.getByLabelText('E-mail'), 'petr@example.com');
    await userEvent.type(screen.getByLabelText('Heslo'), 'abc');
    await userEvent.type(screen.getByLabelText('Název projektu'), 'Eshop');
    await userEvent.click(screen.getByRole('button', { name: 'Založit účet a projekt' }));

    await screen.findByText('Heslo musí mít aspoň 12 znaků. Zadali jste 3 znaky.');

    expect(screen.getByLabelText('Jméno a příjmení')).toHaveValue('Petr Novák');
    expect(screen.getByLabelText('E-mail')).toHaveValue('petr@example.com');
    expect(screen.getByLabelText('Název projektu')).toHaveValue('Eshop');
    expect(container.querySelector('input[name="locale"]')).toHaveValue('cs');
    expect(screen.getByLabelText('Heslo')).toHaveValue('');
  });

  it('při vykreslení s vrácenými hodnotami je nasadí do polí', () => {
    const { container } = render(
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
              request_id: 'req_4',
              errors: [{ path: 'password', code: 'password_too_short', message: 'Krátké heslo.' }],
            },
            fieldErrors: { password: ['Krátké heslo.'] },
            values: {
              name: 'Petr Novák',
              email: 'petr@example.com',
              workspace_name: 'Eshop',
              locale: 'en',
            },
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByLabelText('Jméno a příjmení')).toHaveValue('Petr Novák');
    expect(screen.getByLabelText('E-mail')).toHaveValue('petr@example.com');
    expect(screen.getByLabelText('Název projektu')).toHaveValue('Eshop');
    expect(container.querySelector('input[name="locale"]')).toHaveValue('en');
  });
});
