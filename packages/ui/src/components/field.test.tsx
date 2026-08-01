import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { Input } from './input';

describe('Field', () => {
  it('sváže viditelný popisek s polem', () => {
    render(
      <Field label="E-mail">
        <Input name="email" />
      </Field>,
    );
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
  });

  it('chybu sváže přes aria-describedby a nastaví aria-invalid', () => {
    render(
      <Field label="E-mail" error="Není platná e-mailová adresa. Čekáme tvar jmeno@firma.cz.">
        <Input name="email" />
      </Field>,
    );
    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'Není platná e-mailová adresa.',
    );
  });

  it('nepovinnost označuje slovem, ne hvězdičkou', () => {
    render(
      <Field label="Telefon" optionalLabel="nepovinné">
        <Input name="phone" />
      </Field>,
    );
    expect(screen.getByText('nepovinné')).toBeVisible();
    expect(screen.queryByText('*')).toBeNull();
  });

  it('nápovědu i chybu předá do aria-describedby naráz', () => {
    render(
      <Field label="Slug" hint="Použije se v adrese projektu." error="Slug už existuje.">
        <Input name="slug" />
      </Field>,
    );
    const ids = (screen.getByLabelText('Slug').getAttribute('aria-describedby') as string).split(
      ' ',
    );
    expect(ids).toHaveLength(2);
  });
});
