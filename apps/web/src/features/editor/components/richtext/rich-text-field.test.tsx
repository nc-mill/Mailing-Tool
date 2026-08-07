import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FieldCatalog } from '../../model/field-catalog';
import { RichTextField } from './rich-text-field';

// ProseMirror si po každé změně srovnává výběr do viditelné oblasti a ptá se
// rozsahu na jeho obdélníky. jsdom `Range.getClientRects` nemá, takže by test
// spadl na `target.getClientRects is not a function`, přestože model je v pořádku.
// Polyfill patří sem, ne do `vitest.setup.ts`: ten vlastní P01.
const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    Object.assign([] as unknown as DOMRectList, { item: () => null });
  Range.prototype.getBoundingClientRect = () =>
    ({ ...emptyRect, toJSON: () => emptyRect }) as DOMRect;
}

// Kliknutí do editoru vede ProseMirror na `document.elementFromPoint`, kterou
// jsdom také nemá. Bez ní projde test zeleně, ale běh skončí nezachycenou výjimkou.
if (!Document.prototype.elementFromPoint) {
  Document.prototype.elementFromPoint = () => null;
}

const catalog: FieldCatalog = { version: 'v1', fields: [] };

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe('RichTextField', () => {
  it('má pevný panel s tučně, kurzívou, odkazem, seznamy a vložením personalizace', () => {
    wrap(
      <RichTextField
        id="r1"
        value={[{ t: 'p', children: [] }]}
        onChange={vi.fn()}
        allowLists
        fieldCatalog={catalog}
      />,
    );
    const toolbar = screen.getByRole('toolbar');
    for (const label of [
      'Tučně',
      'Kurzíva',
      'Odkaz',
      'Odrážky',
      'Číslovaný seznam',
      'Vložit personalizaci',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(toolbar).toHaveAttribute('aria-label');
  });

  it('u vlastnosti bez seznamů se tlačítka seznamů nezobrazí', () => {
    wrap(
      <RichTextField
        id="r2"
        value={[{ t: 'p', children: [] }]}
        onChange={vi.fn()}
        allowLists={false}
        fieldCatalog={catalog}
      />,
    );
    expect(screen.queryByRole('button', { name: /Odrážky/ })).toBeNull();
  });

  /**
   * ESC V POLI PRO ADRESU ZAVÍRÁ JEN ŘÁDEK S ODKAZEM.
   *
   * Naměřená vada: plátno mělo Esc obsloužený před pojistkou pro vlastní
   * obsluhu, takže stisk v tomhle poli ukončil psaní celého textu. Zavřít
   * řádek patří tomu, komu řádek patří, tedy liště.
   */
  it('Escape v poli pro adresu zavře jen řádek s odkazem', async () => {
    wrap(
      <RichTextField
        id="r4"
        value={[{ t: 'p', children: [] }]}
        onChange={vi.fn()}
        allowLists
        fieldCatalog={catalog}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Odkaz/ }));
    const url = screen.getByRole('textbox', { name: /Adresa odkazu/ });
    await userEvent.type(url, 'https://example.com');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('textbox', { name: /Adresa odkazu/ })).toBeNull();
    // Psaní textu pokračuje: pole pro text zůstalo na obrazovce.
    expect(screen.getByRole('textbox', { name: /Text bloku/ })).toBeInTheDocument();
  });

  it('psaní vyvolá změnu v modelu, ne v HTML řetězci', async () => {
    const onChange = vi.fn();
    wrap(
      <RichTextField
        id="r3"
        value={[{ t: 'p', children: [] }]}
        onChange={onChange}
        allowLists
        fieldCatalog={catalog}
      />,
    );
    await userEvent.click(screen.getByRole('textbox'));
    await userEvent.keyboard('Ahoj');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last[0].children[0]).toMatchObject({ t: 's', v: 'Ahoj' });
  });
});
