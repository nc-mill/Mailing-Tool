import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import { blockDefaults, DEFAULT_THEME, type EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { TemplateProfileProvider } from '../richtext/template-profile';
import { BlockPalette } from './block-palette';

const document = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: '', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [{ id: 'b_s1', type: 'section', props: { ...blockDefaults('section') }, children: [] }],
  }) as unknown as EditorDocument;

const renderPalette = (profile: ValidationProfile) => {
  const store = createEditorStore({ document: document(), designHash: 'h' });
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}>
        <TemplateProfileProvider value={profile}>
          <BlockPalette />
        </TemplateProfileProvider>
      </EditorStoreProvider>
    </NextIntlClientProvider>,
  );
};

/**
 * Zúžení palety se měří NA PANELU, ne jen na funkci `paletteFor`.
 *
 * Kdyby se testovala jen ta funkce, prošel by panel, který si bere `PALETTE`
 * napřímo, a uživatel by patičku v paletě stránky pořád viděl.
 */
describe('paleta bloků se řídí profilem šablony', () => {
  it('u veřejné stránky nenabídne patičku ani vlastní HTML', () => {
    renderPalette('page');
    expect(screen.queryByTestId('palette-footer')).toBeNull();
    expect(screen.queryByTestId('palette-html')).toBeNull();
  });

  it('u veřejné stránky nabídne zbytek bloků, včetně sloupců', () => {
    renderPalette('page');
    for (const id of ['heading', 'text', 'image', 'button', 'divider', 'spacer', 'social']) {
      expect(screen.getByTestId(`palette-${id}`), id).toBeVisible();
    }
    expect(screen.getByTestId('palette-section')).toBeVisible();
    expect(screen.getByTestId('palette-columns-2')).toBeVisible();
    expect(screen.getByTestId('palette-columns-3')).toBeVisible();
  });

  it('u kampaně zůstává paleta beze změny, patičku i HTML nabídne dál', () => {
    renderPalette('campaign');
    expect(screen.getByTestId('palette-footer')).toBeVisible();
    expect(screen.getByTestId('palette-html')).toBeVisible();
  });
});
