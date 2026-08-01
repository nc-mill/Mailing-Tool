import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldCatalog } from '../../model/field-catalog';
import { TokenInspector } from './token-inspector';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'first_name',
      type: 'string',
      label: { cs: 'Jméno', en: 'First name' },
      group: 'name',
      deleted: false,
    },
    {
      path: 'signup_date',
      type: 'date',
      label: { cs: 'Datum registrace', en: 'Signup date' },
      group: 'custom',
      deleted: false,
    },
    {
      path: 'attr.note',
      type: 'string',
      label: { cs: 'Poznámka', en: 'Note' },
      group: 'custom',
      deleted: false,
    },
  ],
};

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe('inspektor žetonu', () => {
  it('nabídne náhradní hodnotu a odmítne v ní zakázané znaky', async () => {
    const onChange = vi.fn();
    wrap(
      <TokenInspector
        fieldCatalog={catalog}
        onChange={onChange}
        attrs={{ expr: 'contact.first_name', fallback: null, dateFormat: null }}
      />,
    );
    const input = screen.getByLabelText(/Náhradní hodnota/);
    await userEvent.type(input, 'kolego');
    expect(onChange).toHaveBeenLastCalledWith({ fallback: 'kolego' });
    await userEvent.clear(input);
    await userEvent.type(input, 'a"b');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('u data nabídne pět povolených formátů s náhledem výsledku, ne textové pole', () => {
    wrap(
      <TokenInspector
        fieldCatalog={catalog}
        onChange={vi.fn()}
        attrs={{ expr: 'contact.signup_date', fallback: null, dateFormat: null }}
      />,
    );
    const select = screen.getByLabelText(/Formát data/);
    expect([...select.querySelectorAll('option')].map((option) => option.value)).toEqual([
      '',
      '%d.%m.%Y',
      '%-d.%-m.%Y',
      '%Y-%m-%d',
      '%d.%m.%Y %H:%M',
      '%H:%M',
    ]);
  });

  it('u textového pole formát data nenabízí', () => {
    wrap(
      <TokenInspector
        fieldCatalog={catalog}
        onChange={vi.fn()}
        attrs={{ expr: 'contact.first_name', fallback: null, dateFormat: null }}
      />,
    );
    expect(screen.queryByLabelText(/Formát data/)).toBeNull();
  });

  it('u dlouhého textu upozorní, že se odřádkování v e-mailu neprojeví', () => {
    wrap(
      <TokenInspector
        fieldCatalog={catalog}
        onChange={vi.fn()}
        attrs={{ expr: 'contact.attr.note', fallback: null, dateFormat: null }}
      />,
    );
    expect(screen.getByTestId('token-hint')).toBeInTheDocument();
  });
});
