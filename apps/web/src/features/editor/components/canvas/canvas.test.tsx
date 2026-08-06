import messages from '@mlain/i18n/messages/cs/editor.json';
import { LiveRegionProvider } from '@mlain/ui/a11y';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME, type EditorDocument } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
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
  ],
};

/**
 * Vlastnosti se berou z `blockDefaults` a motiv z `DEFAULT_THEME`, ne z prázdných
 * objektů. Plátno teď kreslí skutečný vzhled, takže čte odsazení, barvy a písmo;
 * s `props: {}` a `theme: {}` by nebylo co číst a test by měřil pád, ne chování.
 */
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
            id: 'b_h1',
            type: 'heading',
            props: {
              ...blockDefaults('heading'),
              content: [{ t: 'p', children: [{ t: 's', v: 'Letní výprodej' }] }],
            },
          },
          {
            id: 'b_t1',
            type: 'text',
            props: {
              ...blockDefaults('text'),
              content: [{ t: 'p', children: [{ t: 's', v: 'Text' }] }],
            },
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
          <Canvas canWriteHtml fieldCatalog={catalog} />
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

  /**
   * NÁVRAT K NASTAVENÍ MOTIVU.
   *
   * Panel motivu se ukazuje jen tehdy, když není vybraný žádný blok. Po prvním
   * kliknutí do e-mailu k němu nevedla žádná cesta, takže se uživatel
   * k nastavení pozadí, písem a šířky nedostal jinak než znovunačtením stránky.
   * Zadavatel to hlásil doslova: „už není jak se vrátit k nastavení pozadí
   * motivu". Odznačení se proto měří jako stav výběru, ne jako vzhled panelu:
   * panel je jiná komponenta a na `selectedId` jen reaguje.
   */
  it('klik na plátno mimo blok výběr zruší, a tím se panel vrátí na Motiv', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    expect(store.getState().selectedId).toBe('b_t1');

    // Plocha plátna je obal stromu, tedy to, co je kolem e-mailu.
    await userEvent.click(screen.getByRole('tree').parentElement!);
    expect(store.getState().selectedId).toBeNull();
  });

  /**
   * A TEĎ TA DRUHÁ STRANA: odznačení nesmí ublížit práci s bloky.
   *
   * Obsluha sedí na obalu, kam kliknutí probublávají, což je přesně vzorec,
   * na kterém se to dá pokazit. `BlockChrome` proto probublání zastavuje;
   * kdyby to přestal dělat, klik do bloku by blok vybral a hned zase odznačil.
   */
  it('klik dovnitř bloku výběr nezruší', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    await userEvent.click(screen.getByTestId('block-b_h1'));
    expect(store.getState().selectedId).toBe('b_h1');
  });

  /*
   * POZOR, VRÁCENÍ FOKUSU PO PSANÍ SE TADY OTESTOVAT NEDÁ.
   *
   * V prohlížeči se pole pro psaní odchodem odmontuje a fokus spadne na
   * `<body>`, který uvnitř stromu neleží, takže na plátno nedojde žádná další
   * klávesa. Naměřeno: po prvním Esc hlásil `document.activeElement` `BODY`.
   * Řeší to `stopEditing` v `canvas.tsx`, které fokus vrátí na obal bloku.
   *
   * Test na to tu ale NENÍ schválně: jsdom fokus po odmontování prvku
   * nepřesouvá stejně jako prohlížeč, takže tvrzení projde i s vypnutou
   * opravou. Zkoušeno. Test, který nemůže spadnout, dělá jen falešnou jistotu,
   * a důkazem je proto měření v prohlížeči, ne tenhle soubor.
   */
  it('Escape odznačí blok, ale až když se nepíše', async () => {
    const store = setup();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    expect(store.getState().selectedId).toBe('b_t1');

    // Klik do textového bloku rovnou otevře psaní, takže první Esc opouští
    // psaní a blok zůstává vybraný. Teprve druhý výběr zruší.
    await userEvent.keyboard('{Escape}');
    expect(store.getState().selectedId).toBe('b_t1');
    await userEvent.keyboard('{Escape}');
    expect(store.getState().selectedId).toBeNull();
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
    // Klik do nadpisu rovnou otevře psaní, a při psaní se ovládání bloku
    // schovává, aby nezakrývalo psaný řádek. Esc psaní opustí a blok zůstane
    // vybraný, což je stav, ve kterém ovládání patří na obrazovku.
    await userEvent.keyboard('{Escape}');
    const toolbar = screen.getByTestId('block-toolbar-b_h1');
    expect(toolbar.querySelectorAll('button')).toHaveLength(6);
  });

  /**
   * Naměřený nález zadavatele: při psaní mu přes řádek visely šipky, duplikace
   * a koš. Ovládání se týká bloku jako celku, tedy jiného úmyslu než psát do
   * něj větu, a při psaní na obrazovce nemá co dělat.
   */
  it('při psaní do bloku se jeho ovládání nekreslí', async () => {
    setup();
    await userEvent.click(screen.getByTestId('block-b_h1'));

    expect(screen.queryByTestId('block-toolbar-b_h1')).toBeNull();
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
          props: { ...blockDefaults('section') },
          children: [{ id: 'b_x1', type: 'carousel', props: { foo: 1 } }],
        },
      ],
    } as unknown as EditorDocument);
    expect(screen.getByTestId('block-b_x1')).toHaveAttribute('data-locked', 'true');
  });
});
