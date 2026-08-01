// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { ProfileForm } from './profile-form';

const messages = { settings: csSettings };

const USER = {
  id: 'u1',
  email: 'jana@firma.cz',
  name: 'Jana Nováková',
  locale: 'cs',
  timezone: 'Europe/Prague',
};

function renderForm(initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <ProfileForm
        action={vi.fn()}
        user={USER}
        locales={['cs', 'en']}
        timezones={['Europe/Prague', 'UTC']}
        initialState={initialState}
      />
    </NextIntlClientProvider>,
  );
}

describe('ProfileForm', () => {
  it('předvyplní jméno, jazyk a zónu', () => {
    const { container } = renderForm();
    expect(screen.getByLabelText('Jméno a příjmení')).toHaveValue('Jana Nováková');
    // ODCHYLKA OD PLÁNU, vynucená komponentou P05: `Select` stojí na Radixu
    // a přístupným prvkem je tlačítko (`combobox`), ne `<select>`, takže
    // `toHaveValue` na něm nedává smysl. Hodnota, která jediná dojde na server,
    // sedí ve skrytém poli. Stejný postup má i `select-field.test.tsx`.
    expect(screen.getByLabelText('Jazyk rozhraní')).toBeInTheDocument();
    expect(container.querySelector('input[name="locale"]')).toHaveValue('cs');
    expect(screen.getByLabelText('Časová zóna')).toBeInTheDocument();
    expect(container.querySelector('input[name="timezone"]')).toHaveValue('Europe/Prague');
  });

  it('e-mail ukáže jako text, ne jako upravitelné pole', () => {
    renderForm();
    expect(screen.getByText('jana@firma.cz')).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
    expect(screen.getByText(/měnit se zatím nedá/)).toBeInTheDocument();
  });

  it('po uložení ukáže inline stav Uloženo, ne toast', () => {
    renderForm({ status: 'success', channel: 'inline', messageKey: 'profile.identity.saved' });
    const saved = screen.getByText('Uloženo');
    expect(saved.closest('[role="status"]')).not.toBeNull();
  });

  it('chybu pole ukáže u pole', () => {
    renderForm({
      status: 'error',
      channel: 'inline',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/auth/me',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [{ path: 'timezone', code: 'unknown', message: 'Tuhle zónu neznáme.' }],
      },
      fieldErrors: { timezone: ['Tuhle zónu neznáme.'] },
    });
    expect(screen.getByLabelText('Časová zóna')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Tuhle zónu neznáme.')).toBeInTheDocument();
  });

  it('vysvětlí, k čemu jméno a zóna slouží', () => {
    renderForm();
    expect(screen.getByText(/v audit logu/)).toBeInTheDocument();
    expect(screen.getByText(/zobrazujeme časy v celém nástroji/)).toBeInTheDocument();
  });
});
