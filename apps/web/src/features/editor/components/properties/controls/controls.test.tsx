import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldCatalog } from '../../../model/field-catalog';
import { ColorControl } from './color-control';
import { LinkControl } from './link-control';
import { NumberControl } from './number-control';
import { VisibilityControl } from './visibility-control';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'city',
      type: 'string',
      label: { cs: 'Město', en: 'City' },
      group: 'custom',
      deleted: false,
    },
    {
      path: 'is_vip',
      type: 'boolean',
      label: { cs: 'VIP', en: 'VIP' },
      group: 'custom',
      deleted: false,
    },
    {
      path: 'old',
      type: 'string',
      label: { cs: 'Staré', en: 'Old' },
      group: 'custom',
      deleted: true,
    },
  ],
};

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

const base = {
  block: { id: 'b_1', type: 'text', props: {} },
  canWriteHtml: true,
  fieldCatalog: catalog,
  ports: null,
};

describe('ovládací prvky', () => {
  it('číslo hlídá meze z descriptoru', async () => {
    const onChange = vi.fn();
    wrap(
      <NumberControl
        {...base}
        id="n1"
        onChange={onChange}
        value={24}
        descriptor={{
          kind: 'number',
          key: 'height',
          label: 'prop.height',
          min: 4,
          max: 120,
          step: 4,
          unit: 'px',
        }}
      />,
    );
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('min', '4');
    expect(input).toHaveAttribute('max', '120');
    await userEvent.clear(input);
    await userEvent.type(input, '200');
    expect(onChange).toHaveBeenLastCalledWith(120);
  });

  it('barva nabízí role motivu i vlastní odstín', async () => {
    const onChange = vi.fn();
    wrap(
      <ColorControl
        {...base}
        id="c1"
        onChange={onChange}
        value="text.default"
        descriptor={{ kind: 'color', key: 'color', label: 'prop.color', allowThemeRef: true }}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'brand.primary');
    expect(onChange).toHaveBeenCalledWith('brand.primary');
  });

  it('odkaz odmítne zakázané schéma', async () => {
    const onChange = vi.fn();
    wrap(
      <LinkControl
        {...base}
        id="l1"
        onChange={onChange}
        value=""
        descriptor={{ kind: 'link', key: 'href', label: 'prop.href', trackableKey: 'trackable' }}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), 'javascript:alert(1)');
    expect(screen.getByRole('alert')).toHaveTextContent(/https/);
    expect(onChange).not.toHaveBeenCalledWith('javascript:alert(1)');
  });

  it('podmínka zobrazení nabízí jen pole z katalogu a operátory podle typu', async () => {
    const onChange = vi.fn();
    wrap(
      <VisibilityControl
        {...base}
        id="v1"
        onChange={onChange}
        value={null}
        descriptor={{ kind: 'visibility', key: 'visibleWhen', label: 'prop.visibleWhen' }}
      />,
    );
    const field = screen.getByLabelText(/Pole/);
    expect(screen.queryByText('Staré')).toBeNull(); // smazané pole se nenabízí
    await userEvent.selectOptions(field, 'contact.is_vip');
    const operators = screen.getByLabelText(/Podmínka/);
    expect([...operators.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'true',
      'false',
    ]);
  });

  it('podmínka nad textovým polem nabízí present a blank', async () => {
    wrap(
      <VisibilityControl
        {...base}
        id="v2"
        onChange={vi.fn()}
        value={{ field: 'contact.city', op: 'present' }}
        descriptor={{ kind: 'visibility', key: 'visibleWhen', label: 'prop.visibleWhen' }}
      />,
    );
    const operators = screen.getByLabelText(/Podmínka/);
    expect([...operators.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'present',
      'blank',
    ]);
  });
});
