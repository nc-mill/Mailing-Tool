import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { PropertiesPanel } from './properties-panel';

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
          { id: 'b_sp1', type: 'spacer', props: { height: 24, heightMobile: null } },
          { id: 'b_html', type: 'html', props: { code: '' } },
        ],
      },
    ],
  }) as unknown as EditorDocument;

function setup(selected: string | null) {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  if (selected) store.select(selected);
  const utils = render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}>
        <PropertiesPanel
          canWriteHtml={false}
          fieldCatalog={{ fields: [], version: 'v1' }}
          ports={null}
          templateKind="campaign"
        />
      </EditorStoreProvider>
    </NextIntlClientProvider>,
  );
  return { store, utils };
}

describe('PropertiesPanel', () => {
  it('bez vybraného bloku ukazuje vlastnosti celého e-mailu', () => {
    setup(null);
    expect(screen.getByRole('heading', { name: /Motiv/ })).toBeInTheDocument();
  });

  it('vykreslí skupiny a pole podle descriptoru, ne podle natvrdo psaného formuláře', () => {
    setup('b_sp1');
    expect(screen.getByRole('group', { name: /Vzhled/ })).toBeInTheDocument();
    // Přesná shoda: `heightMobile` má popisek „Výška na mobilu", takže by volný
    // vzor /Výška/ našel dvě pole a dotaz by skončil chybou o dvou shodách.
    expect(screen.getByLabelText(/^Výška$/)).toHaveValue(24);
  });

  it('změna hodnoty projde do dokumentu', async () => {
    const { store } = setup('b_sp1');
    const input = screen.getByLabelText(/^Výška$/);
    await userEvent.clear(input);
    await userEvent.type(input, '48');
    expect(store.getState().document.blocks[0]?.children?.[0]?.props.height).toBe(48);
  });

  it('vlastnost chráněná oprávněním se bez něj zobrazí jen pro čtení s vysvětlením', () => {
    setup('b_html');
    expect(screen.getByTestId('prop-code')).toHaveAttribute('data-readonly', 'true');
  });

  it('u vlastnosti s poznámkou o Outlooku je vysvětlující ikona', () => {
    setup('b_sp1');
    expect(screen.getByTestId('hint-hideOnMobile')).toBeInTheDocument();
  });

  /**
   * Co nemá vliv, se nedá nastavit.
   *
   * `SpacerBlockView` v emitteru posílá do rámu natvrdo nulové odsazení
   * a `heightMobile` nečte ani emitter, ani `buildHeadCss`. Obojí se dřív
   * nastavit dalo a nemělo to žádný následek ani v e-mailu, ani na plátně.
   */
  it('mezera nenabízí odsazení ani mobilní výšku, protože je emitter ignoruje', () => {
    setup('b_sp1');
    expect(screen.getByTestId('prop-height')).toBeInTheDocument();
    expect(screen.queryByTestId('prop-padding')).toBeNull();
    expect(screen.queryByTestId('prop-heightMobile')).toBeNull();
  });
});
