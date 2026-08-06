import messages from '@mlain/i18n/messages/cs/editor.json';
import { LiveRegionProvider } from '@mlain/ui/a11y';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import {
  blockDefaults,
  DEFAULT_THEME,
  type EditorDocument,
  type RichText,
} from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { createFakePorts } from '../../ports/fake-ports';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
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

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'greeting',
      type: 'string',
      label: { cs: 'Oslovení', en: 'Greeting' },
      group: 'name',
      deleted: false,
    },
  ],
};

function doc(overrides: Partial<Record<string, unknown>> = {}): EditorDocument {
  return {
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
              content: [
                {
                  t: 'p',
                  children: [
                    { t: 'var', expr: 'contact.greeting' },
                    { t: 's', v: ', vítejte.' },
                  ],
                },
              ],
            },
          },
          {
            id: 'b_i1',
            type: 'image',
            props: { ...blockDefaults('image'), assetId: '', alt: 'Logo' },
          },
          ...((overrides.extra as unknown[]) ?? []),
        ],
      },
    ],
  } as unknown as EditorDocument;
}

function renderCanvas(document: EditorDocument = doc()) {
  const store = createEditorStore({ document, designHash: 'h1' });
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <LiveRegionProvider label="Oznámení">
        <EditorStoreProvider value={store}>
          <FieldCatalogProvider value={catalog}>
            <Canvas canWriteHtml fieldCatalog={catalog} ports={createFakePorts()} />
          </FieldCatalogProvider>
        </EditorStoreProvider>
      </LiveRegionProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

const contentOf = (store: ReturnType<typeof createEditorStore>, id: string): RichText =>
  (store.getState().document.blocks[0]?.children?.find((block) => block.id === id)?.props
    .content as RichText) ?? [];

describe('WYSIWYG plátno', () => {
  it('kreslí text v barvě a písmu z motivu, ne v písmu aplikace', () => {
    renderCanvas();
    const block = screen.getByTestId('block-b_t1');
    const frame = block.querySelector('div[style*="font-family"]');
    expect(frame).not.toBeNull();
    // `text.default` z výchozí palety P08. Kdyby plátno motiv nečetlo,
    // zdědila by se barva aplikace a tenhle styl by tu vůbec nebyl.
    expect(frame!.getAttribute('style')).toContain('color');
    expect(frame!.getAttribute('style')).toContain('font-size: 16px');
  });

  it('personalizaci kreslí jako štítek s lidským popiskem, ne jako {{ }}', () => {
    renderCanvas();
    const token = screen.getByTestId('token');
    expect(token).toHaveTextContent('Oslovení');
    expect(token.textContent).not.toContain('{{');
    expect(screen.getByTestId('block-b_t1').textContent).not.toContain('contact.greeting');
  });

  it('kliknutí do textu otevře psaní přímo v ploše', async () => {
    renderCanvas();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    expect(screen.getByTestId('block-b_t1').querySelector('[data-inline-editor]')).not.toBeNull();
    // Personalizace je u textu, ne v panelu vlastností: ten položky `richtext`
    // schválně odfiltruje, takže tohle je jediná cesta, jak ji do textu dostat.
    expect(screen.getByRole('button', { name: /Vložit personalizaci/ })).toBeInTheDocument();
  });

  /**
   * Naměřený nález zadavatele: „pro samé ikony kolem nevidím obsah a nevím,
   * co píšu." Nad textem viselo ovládání bloku a pod ním lišta formátování,
   * obojí přes psaný řádek.
   *
   * Pravidlo, které z toho plyne: formátování se týká VÝBĚRU, takže se lišta
   * ukazuje jen nad označeným textem. Samotný kurzor nemá co formátovat.
   *
   * Kdyby tenhle test spadl: neupravuj ho. Znamená to, že lišta zase zakrývá
   * text, do kterého se píše.
   */
  it('při psaní bez označení se lišta formátování nekreslí', async () => {
    renderCanvas();
    await userEvent.click(screen.getByTestId('block-b_t1'));

    expect(screen.queryByTestId('inline-toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: /Tučně/ })).toBeNull();
    // Vkládání personalizace zůstává: to se dělá na místo kurzoru, ne na výběr.
    expect(screen.getByTestId('inline-personalization')).toBeInTheDocument();
  });

  /*
   * Skutečné psaní do `contenteditable` se v jsdom otestovat nedá: ProseMirror
   * při vkládání volá `elementFromPoint` a `getClientRects`, které jsdom nemá.
   * Rozdělené je to proto na dvě části, které otestovat jdou:
   *   - tady, že editor na plátně dostane obsah dokumentu a že v něm je uzel
   *     personalizace, tedy že je napojený na tentýž blok a tatáž rozšíření,
   *   - v `model/richtext.test.ts`, že se úpravy převedou zpátky do dokumentu.
   * Že spolu ty dvě části fungují, je ověřené klikáním v běžící instalaci.
   */
  it('editor na plátně nese obsah právě toho bloku, do kterého se kliklo', async () => {
    const store = renderCanvas();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    const editor = screen
      .getByTestId('block-b_t1')
      .querySelector<HTMLElement>('[data-inline-editor]');
    expect(editor).not.toBeNull();
    expect(editor!.textContent).toContain(', vítejte.');
    // Uzel personalizace je i v režimu psaní štítkem, ne syrovým výrazem.
    expect(editor!.textContent).not.toContain('contact.greeting');
    expect(contentOf(store, 'b_t1')).toHaveLength(1);
  });

  it('Escape psaní ukončí a blok zůstane vybraný', async () => {
    const store = renderCanvas();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    const editor = screen
      .getByTestId('block-b_t1')
      .querySelector<HTMLElement>('[data-inline-editor]');
    // `fireEvent`, ne `userEvent`: událost musí dojít přímo na uzel, na kterém
    // ProseMirror poslouchá. `userEvent.keyboard` míří na aktivní prvek a ten
    // v jsdom po namontování editoru spolehlivě uvnitř editoru není.
    fireEvent.keyDown(editor!, { key: 'Escape' });
    expect(screen.getByTestId('block-b_t1').querySelector('[data-inline-editor]')).toBeNull();
    expect(store.getState().selectedId).toBe('b_t1');
  });

  it('blok bez textu psaní neotevře a klávesnice dál patří stromu', async () => {
    renderCanvas();
    await userEvent.click(screen.getByTestId('block-b_i1'));
    expect(screen.getByTestId('block-b_i1').querySelector('[data-inline-editor]')).toBeNull();
  });

  it('obrázek bez souboru zve k výběru, nehlásí, že zmizel z knihovny', async () => {
    renderCanvas();
    const placeholder = screen.getByTestId('image-placeholder');
    expect(placeholder).toHaveTextContent('Klepnutím vyberte obrázek');
    expect(placeholder.textContent).not.toContain('už v knihovně není');
    // Klik otevře knihovnu rovnou z plátna, bez cesty přes panel vlastností.
    await userEvent.click(placeholder);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Obrázky');
  });

  it('nadpis kreslí skutečnou úrovní a velikostí z motivu', () => {
    const withHeading = doc({
      extra: [
        {
          id: 'b_h1',
          type: 'heading',
          props: {
            ...blockDefaults('heading'),
            level: 1,
            content: [{ t: 'p', children: [{ t: 's', v: 'Nadpis' }] }],
          },
        },
      ],
    });
    renderCanvas(withHeading);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Nadpis');
    // 31 px je `headingSize(1)` z výchozího motivu P08 (16 px, poměr 1.25).
    // Kdyby plátno motiv nečetlo, byla by tu velikost z písma aplikace.
    expect(heading.getAttribute('style')).toContain('font-size: 31px');
  });

  it('blok html bez oprávnění ukáže vysvětlení, ne prázdno', () => {
    const withHtml = doc({
      extra: [{ id: 'b_x1', type: 'html', props: { ...blockDefaults('html'), code: '<b>x</b>' } }],
    });
    const store = createEditorStore({ document: withHtml, designHash: 'h1' });
    render(
      <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
        <LiveRegionProvider label="Oznámení">
          <EditorStoreProvider value={store}>
            <FieldCatalogProvider value={catalog}>
              <Canvas canWriteHtml={false} fieldCatalog={catalog} ports={createFakePorts()} />
            </FieldCatalogProvider>
          </EditorStoreProvider>
        </LiveRegionProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('html-forbidden')).toBeInTheDocument();
    // Cizí HTML se do stránky editoru nikdy nevkládá jako živý markup.
    expect(screen.getByTestId('block-b_x1').innerHTML).not.toContain('<b>x</b>');
  });

  it('sloupce kreslí vedle sebe, ne pod sebou jako odsazený seznam', () => {
    const withColumns = doc({
      extra: [
        {
          id: 'b_c1',
          type: 'columns',
          props: { ...blockDefaults('columns'), layout: '1-1' },
          children: [
            { id: 'b_col1', type: 'column', props: { ...blockDefaults('column') }, children: [] },
            { id: 'b_col2', type: 'column', props: { ...blockDefaults('column') }, children: [] },
          ],
        },
      ],
    });
    renderCanvas(withColumns);
    const columns = screen.getByTestId('block-b_c1');
    const row = columns.querySelector('div[style*="display: flex"]');
    expect(row).not.toBeNull();
    // Dvě stejně široké buňky vedle sebe. Dřív se sloupce kreslily jako dvě
    // položky pod sebou, jen odsazené o dvanáct pixelů.
    expect(row!.children).toHaveLength(2);
  });
});

/**
 * PSANÍ SE MUSÍ PROPSAT DO DOKUMENTU, jinak se nemá co uložit.
 *
 * Naměřený nález: „napsal jsem 31 znaků a ukazatel ukládání se nepohnul."
 * Cesta od úhozu k uloženému e-mailu má tři místa a každé umí selhat zvlášť:
 * úhoz dojde do `contenteditable`, ProseMirror z něj udělá změnu dokumentu
 * (`onUpdate` → `patchProps`), a teprve pak se automatické ukládání spustí,
 * protože stojí na `isDirty`. Test níž hlídá PROSTŘEDNÍ krok: bez něj zůstane
 * napsaný text jen v DOM a při odchodu ze stránky zmizí, aniž by kdy vznikl
 * důvod k uložení.
 *
 * Úhoz se nedělá klávesnicí, ale zápisem do textového uzlu. Skutečné vkládání
 * v jsdom padá na `elementFromPoint` a `getClientRects` (viz komentář výš),
 * kdežto změnu DOM si ProseMirror přečte přes `MutationObserver`, a to je táž
 * cesta, kterou v prohlížeči přichází psaní.
 */
describe('psaní na plátně', () => {
  it('napsaný znak se propíše do dokumentu, ne jen do DOM', async () => {
    const store = renderCanvas();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    const editor = screen
      .getByTestId('block-b_t1')
      .querySelector<HTMLElement>('[data-inline-editor]');
    expect(editor).not.toBeNull();

    const walker = window.document.createTreeWalker(editor!, NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.includes('vítejte')) target = node;
    }
    expect(target).not.toBeNull();
    target!.appendData(' Ahoj');

    await waitFor(() => {
      expect(JSON.stringify(contentOf(store, 'b_t1'))).toContain('Ahoj');
    });
    // A tím pádem je co ukládat: na `isDirty` stojí `use-autosave` dvakrát.
    expect(store.getState().isDirty).toBe(true);
  });
});

/**
 * ZADÁVÁNÍ ODKAZU V PLOVOUCÍ LIŠTĚ.
 *
 * Naměřený nález zadavatele: „do pole pro odkaz nejde psát." V prohlížeči to
 * vypadalo takhle: po kliknutí do pole zůstal `document.activeElement` na
 * `[data-inline-editor]`, tedy na textu pod lištou, a napsaná adresa přepsala
 * označený text. Pole samo bylo v pořádku, sebraly mu fokus a klávesnici dvě
 * obsluhy nad ním. Testy níž míří přesně na ně, ne na to, že se pole vykreslí.
 *
 * Výběr se dělá klávesou `Mod+A`, ne myší: skutečné tažení myší se v jsdom
 * nedá udělat, ale `Mod+A` obslouží ProseMirror ve svém keymapu i bez rozvržení
 * stránky, a lišta se ukazuje jen nad neprázdným výběrem.
 */
describe('pole pro adresu odkazu', () => {
  async function openLinkRow() {
    const store = renderCanvas();
    await userEvent.click(screen.getByTestId('block-b_t1'));
    const editor = screen
      .getByTestId('block-b_t1')
      .querySelector<HTMLElement>('[data-inline-editor]');
    fireEvent.keyDown(editor!, { key: 'a', ctrlKey: true });
    await userEvent.click(screen.getByRole('button', { name: 'Odkaz' }));
    return { store, input: screen.getByRole('textbox', { name: 'Adresa odkazu' }) };
  }

  /**
   * Kdyby tenhle test spadl: obal lišty zase potlačuje výchozí chování
   * `mousedown` plošně. Tím se do pole nedá kliknout, protože fokus mu dá
   * teprve výchozí akce prohlížeče. Tlačítkům se potlačit MUSÍ, jinak by
   * kliknutí na „tučně" zahodilo výběr v textu, takže rozhoduje cíl kliknutí.
   */
  it('kliknutí do pole si smí vzít fokus, kliknutí na tlačítko výběr v textu nezahodí', async () => {
    const { input } = await openLinkRow();

    // `fireEvent` vrací `false`, když obsluha zavolala `preventDefault`.
    expect(fireEvent.mouseDown(input)).toBe(true);
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Tučně' }))).toBe(false);
  });

  /**
   * Kdyby tenhle test spadl: plátno si zase bere klávesy z ovládacích prvků,
   * které leží uvnitř stromu. Naměřeno v prohlížeči: `Backspace` při psaní
   * adresy nesmazal znak, ale celý blok, protože obsluha stromu ho spárovala
   * s operací „smazat blok" a zavolala `preventDefault`.
   */
  it('Backspace v poli maže znak, ne blok pod lištou', async () => {
    const { store, input } = await openLinkRow();
    const countBlocks = () => store.getState().document.blocks[0]?.children?.length;
    const before = countBlocks();

    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(countBlocks()).toBe(before);
    expect(screen.getByTestId('block-b_t1')).toBeInTheDocument();
  });

  /**
   * Enter v poli odesílá formulář, tedy vkládá odkaz. Kdyby ho plátno spárovalo
   * s operací „upravit obsah" a potlačilo, odeslání by se nikdy nestalo
   * a adresu by nešlo potvrdit klávesnicí.
   */
  it('Enter v poli zůstane formuláři, plátno ho nepotlačí', async () => {
    const { input } = await openLinkRow();

    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
  });
});
