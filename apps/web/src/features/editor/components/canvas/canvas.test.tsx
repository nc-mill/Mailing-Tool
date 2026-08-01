import messages from '@mlain/i18n/messages/cs/editor.json';
import { LiveRegionProvider } from '@mlain/ui/a11y';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { Canvas } from './canvas';

// Radix menu se v jsdom neotevře bez těchhle dvou metod. Polyfill patří sem,
// ne do `vitest.setup.ts`: ten vlastní P01 a tenhle plán do něj nesahá.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const document = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: '', language: 'cs' },
    theme: {},
    blocks: [
      {
        id: 'b_s1',
        type: 'section',
        props: {},
        children: [
          {
            id: 'b_h1',
            type: 'heading',
            props: { content: [{ t: 'p', children: [{ t: 's', v: 'Letní výprodej' }] }] },
          },
          {
            id: 'b_t1',
            type: 'text',
            props: { content: [{ t: 'p', children: [{ t: 's', v: 'Text' }] }] },
          },
        ],
      },
    ],
  }) as unknown as EditorDocument;

function renderCanvas(doc: EditorDocument) {
  const store = createEditorStore({ document: doc, designHash: 'h1' });
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <LiveRegionProvider label="Oznámení">
        <EditorStoreProvider value={store}>
          <Canvas canWriteHtml />
        </EditorStoreProvider>
      </LiveRegionProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

const setup = () => renderCanvas(document());

describe('Canvas', () => {
  it('kreslí strom s rolemi, úrovněmi a pozicemi', () => {
    setup();
    const tree = screen.getByRole('tree');
    expect(tree).toHaveAttribute('aria-label');
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute('aria-level', '2');
    expect(items[1]).toHaveAttribute('aria-posinset', '1');
    expect(items[1]).toHaveAttribute('aria-setsize', '2');
  });

  it('má jediný tabstop, takže se z plátna dá vyjít Tabem', () => {
    setup();
    const focusable = screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0);
    expect(focusable).toHaveLength(1);
  });

  it('kliknutí blok vybere a vybraný blok je označený pro čtečku', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    expect(store.getState().selectedId).toBe('b_t1');
    expect(screen.getByTestId('block-b_t1')).toHaveAttribute('aria-selected', 'true');
  });

  it('Alt se šipkou dolů přesune vybraný blok', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('block-b_h1'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(store.getState().document.blocks[0]?.children?.map((b) => b.id)).toEqual([
      'b_t1',
      'b_h1',
    ]);
  });

  it('ovládání bloku nabízí všech šest operací také myší', async () => {
    setup();
    await userEvent.click(screen.getByTestId('block-b_h1'));
    const toolbar = screen.getByTestId('block-toolbar-b_h1');
    expect(toolbar.querySelectorAll('button')).toHaveLength(6);
  });

  it('tlačítko + mezi bloky otevře paletu a vloží blok na dané místo', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('insert-after-b_h1'));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Oddělovač/ }));
    expect(store.getState().document.blocks[0]?.children?.map((b) => b.type)).toEqual([
      'heading',
      'divider',
      'text',
    ]);
  });

  it('neznámý blok se kreslí jako zamčený placeholder', () => {
    renderCanvas({
      ...document(),
      blocks: [
        {
          id: 'b_s1',
          type: 'section',
          props: {},
          children: [{ id: 'b_x1', type: 'carousel', props: { foo: 1 } }],
        },
      ],
    } as unknown as EditorDocument);
    expect(screen.getByTestId('block-b_x1')).toHaveAttribute('data-locked', 'true');
  });
});
