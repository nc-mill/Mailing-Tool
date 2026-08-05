import messages from '@mlain/i18n/messages/cs/editor.json';
import { LiveRegionProvider } from '@mlain/ui/a11y';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME, type EditorDocument } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { createFakePorts } from '../../ports/fake-ports';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { PropertiesPanel } from '../properties/properties-panel';
import { FieldCatalogProvider } from '../richtext/field-labels';
import { Canvas } from './canvas';

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

/** Sekce s rozvržením na dva sloupce: levý prázdný, pravý s textem. */
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
            id: 'b_c1',
            type: 'columns',
            props: { ...blockDefaults('columns'), layout: '1-1' },
            children: [
              { id: 'b_col1', type: 'column', props: { ...blockDefaults('column') }, children: [] },
              {
                id: 'b_col2',
                type: 'column',
                props: { ...blockDefaults('column') },
                children: [
                  {
                    id: 'b_t1',
                    type: 'text',
                    props: {
                      ...blockDefaults('text'),
                      content: [{ t: 'p', children: [{ t: 's', v: 'Vpravo' }] }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as EditorDocument;

function setup() {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
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

const columnChildren = (store: ReturnType<typeof createEditorStore>, column: number) =>
  store.getState().document.blocks[0]?.children?.[0]?.children?.[column]?.children ?? [];

/**
 * Rozvržení do sloupců bylo v paletě mrtvá položka.
 *
 * `BlockView` nemělo pro typ `column` větev, takže sloupec spadl do `default`
 * a nakreslil se jako `LockedView` s cedulí „tenhle blok jde jen prohlížet".
 * Obsah sloupce se nevykreslil vůbec a nešlo do něj nic vložit ani v něm nic
 * upravit, přestože model i emitter potomky sloupce znají.
 */
describe('obsah ve sloupcích', () => {
  it('sloupec kreslí svůj obsah, ne ceduli o zamčeném bloku', () => {
    setup();
    expect(screen.getByTestId('block-b_t1')).toHaveTextContent('Vpravo');
    expect(screen.queryByText(/jde jen prohlížet/)).toBeNull();
  });

  it('prázdný sloupec je vidět a zve k vložení', () => {
    setup();
    const empty = screen.getByTestId('empty-slot-0.0.0');
    expect(empty).toHaveTextContent('Prázdný sloupec');
    expect(screen.getByTestId('insert-into-0.0.0')).toBeInTheDocument();
  });

  it('tlačítko v prázdném sloupci vloží blok dovnitř sloupce', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('insert-into-0.0.0'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    expect(columnChildren(store, 0)).toHaveLength(1);
    expect(columnChildren(store, 0)[0]?.type).toBe('text');
  });

  it('nabídka v sloupci nenabízí, co tam podle gramatiky nepatří', async () => {
    setup();
    await userEvent.click(screen.getByTestId('insert-into-0.0.0'));
    expect(await screen.findByRole('menuitem', { name: 'Obrázek' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sekce' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Dva sloupce' })).toBeNull();
  });

  it('blok ve sloupci jde vybrat a otevře se pro něj panel vlastností', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    expect(store.getState().selectedId).toBe('b_t1');
    expect(screen.getByRole('heading', { name: 'Text' })).toBeInTheDocument();
  });

  it('blok ve sloupci jde vytáhnout ven i smazat', () => {
    const store = setup();
    store.select('b_t1');
    // `Alt+←` = ven z rodiče. Táž operace, jakou nabízí ovládání bloku.
    expect(store.moveByKeyboard('b_t1', 'out')).toBe(true);
    expect(columnChildren(store, 1)).toHaveLength(0);
    store.removeBlock('b_t1');
    expect(store.getState().document.blocks[0]?.children).toHaveLength(1);
  });
});
