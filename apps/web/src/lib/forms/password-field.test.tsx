// Matchery jest-dom se typují modulovou augmentací. Registruje je
// `apps/web/vitest.setup.ts`, jenže ten soubor vlastní P01 a v `tsconfig.json`
// není v `include`, takže `tsc` augmentaci nevidí. Import tady je typová
// oprava bez dopadu na chování: modul se stejně načítá v setupu.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordField } from './password-field';

const base = {
  name: 'password',
  label: 'Heslo',
  autoComplete: 'new-password' as const,
  showLabel: 'Zobrazit heslo',
  hideLabel: 'Skrýt heslo',
};

describe('PasswordField', () => {
  it('má viditelný popisek svázaný s polem', () => {
    render(<PasswordField {...base} errors={{}} />);
    expect(screen.getByLabelText('Heslo')).toBeInTheDocument();
  });

  it('umožní zobrazit a skrýt heslo', async () => {
    render(<PasswordField {...base} errors={{}} />);
    const input = screen.getByLabelText('Heslo');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Zobrazit heslo' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Skrýt heslo' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('nebrání vložení ze schránky', () => {
    render(<PasswordField {...base} errors={{}} />);
    const input = screen.getByLabelText('Heslo');
    expect(input).not.toHaveAttribute('onpaste');
    expect(input).not.toHaveAttribute('onPaste');
  });

  it('chybu sváže s polem přes aria-describedby a aria-invalid', () => {
    render(<PasswordField {...base} errors={{ password: ['Heslo musí mít aspoň 12 znaků.'] }} />);
    const input = screen.getByLabelText('Heslo');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'field-error-password');
    expect(screen.getByText('Heslo musí mít aspoň 12 znaků.')).toHaveAttribute(
      'id',
      'field-error-password',
    );
  });

  it('nápovědu sváže s polem, když chyba není', () => {
    render(<PasswordField {...base} hint="Aspoň 12 znaků." errors={{}} />);
    expect(screen.getByLabelText('Heslo')).toHaveAttribute('aria-describedby');
  });
});
