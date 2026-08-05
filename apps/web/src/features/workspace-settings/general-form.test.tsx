// Matchery jest-dom se typují modulovou augmentací, viz komentář v select-field.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csSettings from '../../../../../packages/i18n/messages/cs/settings.json';
import type { ActionState } from '@/lib/feedback/action-result';
import { GeneralForm } from './general-form';

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

function renderForm(canWrite: boolean, initialState?: ActionState) {
  return render(
    <NextIntlClientProvider locale="cs" messages={messages} timeZone="Europe/Prague">
      <GeneralForm
        action={vi.fn()}
        workspace={WORKSPACE}
        locales={['cs', 'en']}
        timezones={['Europe/Prague', 'UTC']}
        canWrite={canWrite}
        initialState={initialState}
      />
    </NextIntlClientProvider>,
  );
}

describe('GeneralForm', () => {
  it('předvyplní název, adresu, jazyk a zónu', () => {
    const { container } = renderForm(true);
    expect(screen.getByLabelText('Název projektu')).toHaveValue('E-shop Kolo');
    expect(screen.getByLabelText('Adresa projektu')).toHaveValue('eshop-kolo');
    // ODCHYLKA OD PLÁNU, vynucená rozhraním P05: `Select` je Radix, tedy
    // `<button>`, a `toHaveValue` na něm nedává smysl. Hodnota, která jediná
    // dojde na server, sedí ve skrytém poli. Stejně to dělá i test profilu.
    expect(screen.getByLabelText('Jazyk projektu')).toBeInTheDocument();
    expect(container.querySelector('input[name="locale"]')).toHaveValue('cs');
    expect(screen.getByLabelText('Časová zóna projektu')).toBeInTheDocument();
    expect(container.querySelector('input[name="timezone"]')).toHaveValue('Europe/Prague');
  });

  it('upozorní, že změna adresy rozbije poslané odkazy', () => {
    renderForm(true);
    expect(screen.getByText(/rozbije odkazy, které jste už poslali/)).toBeInTheDocument();
  });

  it('bez oprávnění zápisu ukáže hodnoty jako text, ne jako zašedlá pole', () => {
    renderForm(false);
    expect(screen.queryByLabelText('Název projektu')).not.toBeInTheDocument();
    expect(screen.getByText('E-shop Kolo')).toBeInTheDocument();
    // Hledá se **každý** zašedlý ovládací prvek, ne jen nativní `select`.
    // `Select` z P05 stojí na Radixu a vykreslí `<button>`, takže dotaz na
    // `select[disabled]` by nikdy nic nenašel a kontrola by procházela
    // naprázdno, ať by v DOM bylo cokoli.
    const disabled = document.querySelectorAll(
      'input[disabled], select[disabled], button[disabled], textarea[disabled], [aria-disabled="true"], [data-disabled]',
    );
    expect(disabled).toHaveLength(0);
  });

  it('bez oprávnění zápisu nevykreslí tlačítko Uložit', () => {
    renderForm(false);
    expect(screen.queryByRole('button', { name: 'Uložit' })).not.toBeInTheDocument();
  });

  it('po uložení ukáže inline stav Uloženo', () => {
    renderForm(true, { status: 'success', channel: 'inline', messageKey: 'shared.saved' });
    expect(screen.getByText('Uloženo').closest('[role="status"]')).not.toBeNull();
  });

  it('chybu jedinečnosti adresy ukáže u pole slug', () => {
    renderForm(true, {
      status: 'error',
      channel: 'inline',
      problem: {
        type: '',
        title: 'Validation failed',
        status: 422,
        detail: '',
        instance: '/api/v1/workspaces/ws1',
        code: 'validation_failed',
        request_id: 'req_1',
        errors: [
          { path: 'slug', code: 'already_exists', message: 'Tuhle adresu už jiný projekt má.' },
        ],
      },
      fieldErrors: { slug: ['Tuhle adresu už jiný projekt má.'] },
    });
    expect(screen.getByLabelText('Adresa projektu')).toHaveAttribute('aria-invalid', 'true');
  });
});
