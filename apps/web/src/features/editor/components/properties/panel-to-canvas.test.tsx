import messages from '@mlain/i18n/messages/cs/editor.json';
import { LiveRegionProvider } from '@mlain/ui/a11y';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME, type EditorDocument } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { createFakePorts } from '../../ports/fake-ports';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { Canvas } from '../canvas/canvas';
import { FieldCatalogProvider } from '../richtext/field-labels';
import { PropertiesPanel } from './properties-panel';

// Radix a ProseMirror v jsdom potřebují pár metod, které tam nejsou.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const catalog: FieldCatalog = { version: 'v1', fields: [] };

const document = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: '', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_s1',
        type: 'section',
        props: { ...blockDefaults('section') },
        children: [
          {
            id: 'b_t1',
            type: 'text',
            props: {
              ...blockDefaults('text'),
              content: [{ t: 'p', children: [{ t: 's', v: 'Ahoj' }] }],
            },
          },
          {
            id: 'b_d1',
            type: 'divider',
            props: { ...blockDefaults('divider') },
          },
        ],
      },
    ],
  }) as unknown as EditorDocument;

/**
 * Panel vlastností a plátno vedle sebe, jako ve skořápce.
 *
 * Vada, kvůli které tenhle soubor vznikl: uživatel hlásil, že se změny
 * z postranního panelu na ploše neprojeví. Plátno teď kreslí skutečný e-mail,
 * takže tohle je hlavní smyčka celé přestavby a musí ji hlídat test, ne oko.
 */
function setup(selected: string) {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  store.select(selected);
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <LiveRegionProvider label="Oznámení">
        <EditorStoreProvider value={store}>
          <FieldCatalogProvider value={catalog}>
            <Canvas canWriteHtml fieldCatalog={catalog} ports={createFakePorts()} />
            <PropertiesPanel
              canWriteHtml
              fieldCatalog={catalog}
              ports={createFakePorts()}
              templateKind="campaign"
            />
          </FieldCatalogProvider>
        </EditorStoreProvider>
      </LiveRegionProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

const markup = (id: string) => screen.getByTestId(`block-${id}`).innerHTML;

/**
 * Číselná pole se plní `fireEvent.change`, ne psaním po znacích.
 *
 * `NumberControl` po každém úhozu ořízne hodnotu na povolený rozsah, takže
 * napsat „28" do pole s rozsahem 10 až 32 dá po prvním znaku 10 a po druhém 32
 * („108" oříznuté shora). To je vlastnost ovládání, ne vada propojení, a test
 * má měřit propojení.
 */
const setNumber = (testId: string, value: string) => {
  const input = screen.getByTestId(testId).querySelector('input');
  fireEvent.change(input!, { target: { value } });
};

describe('změna v panelu se hned promítne do plátna', () => {
  it('odsazení textu', () => {
    setup('b_t1');
    expect(markup('b_t1')).toContain('padding: 0px 24px 16px');
    const top = screen.getByLabelText('Odsazení: Nahoře');
    fireEvent.change(top, { target: { value: '40' } });
    expect(markup('b_t1')).toContain('padding: 40px 24px 16px');
  });

  it('velikost písma textu', () => {
    setup('b_t1');
    setNumber('prop-fontSize', '28');
    expect(markup('b_t1')).toContain('font-size: 28px');
  });

  it('zarovnání textu', async () => {
    setup('b_t1');
    await userEvent.selectOptions(screen.getByLabelText('Zarovnání'), 'center');
    expect(markup('b_t1')).toContain('text-align: center');
  });

  it('tloušťka oddělovače', async () => {
    setup('b_d1');
    // Tloušťka je výběr z hodnot 1 až 4 px, ne volné číslo.
    await userEvent.selectOptions(screen.getByLabelText(/^Tloušťka$/), '3');
    expect(markup('b_d1')).toContain('border-top: 3px');
  });

  it('barva pozadí bloku', async () => {
    const store = setup('b_d1');
    await userEvent.selectOptions(screen.getByLabelText(/Barva pozadí/), 'brand.primary');
    expect(store.getState().document.blocks[0]?.children?.[1]?.props.backgroundColor).toBe(
      'brand.primary',
    );
    // Barva role z motivu, spočítaná `resolveTheme`, ne třídou aplikace.
    expect(markup('b_d1')).toContain('background-color: rgb(');
  });
});
