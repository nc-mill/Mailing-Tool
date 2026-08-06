import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { ThemePanel } from './theme-panel';

const document = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'Letní výprodej', previewText: '', language: 'cs' },
    theme: { contentWidth: 600 },
    blocks: [],
  }) as unknown as EditorDocument;

function setup(contentKind: 'template' | 'campaign' = 'template') {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}>
        <ThemePanel contentKind={contentKind} />
      </EditorStoreProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

describe('ThemePanel', () => {
  it('ukazuje šířku obsahu, písma, velikost a tmavý režim', () => {
    setup();
    expect(screen.getByLabelText(/Šířka obsahu/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Písmo nadpisů/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tmavý režim/)).toBeInTheDocument();
  });

  it('změna šířky zapíše do motivu, ne do bloku', async () => {
    const store = setup();
    await userEvent.selectOptions(screen.getByLabelText(/Šířka obsahu/), '640');
    expect(store.getState().document.theme.contentWidth).toBe(640);
  });

  it('úvodní řádek a název se ukládají do meta', async () => {
    const store = setup();
    await userEvent.type(screen.getByLabelText(/Úvodní řádek/), 'Slevy končí');
    expect(store.getState().document.meta.previewText).toBe('Slevy končí');
  });

  /**
   * U KAMPANĚ SE ÚVODNÍ ŘÁDEK NENABÍZÍ.
   *
   * Kompilace kampaně bere předhlavičku z kroku 2 (`campaigns.preheader`)
   * a po dokumentu sáhne, jen když je krok 2 prázdný. Dvě pole na tutéž věc,
   * z nichž jedno skoro vždy prohraje, mátla víc, než pomáhala.
   */
  it('u kampaně se úvodní řádek nenabízí, u samostatné šablony ano', () => {
    setup('campaign');
    expect(screen.queryByLabelText(/Úvodní řádek/)).toBeNull();
    expect(screen.queryByTestId('prop-previewText')).toBeNull();
    // Zbytek panelu zůstává, nezmizel celý motiv.
    expect(screen.getByLabelText(/Šířka obsahu/)).toBeInTheDocument();
  });

  it('u úvodního řádku je nápověda, kde se text ukáže', () => {
    setup();
    const hint = screen.getByTestId('hint-previewText');
    // Nápověda musí říct TO, co uživatele mátlo: text není v těle e-mailu.
    expect(hint).toHaveAttribute('aria-label', expect.stringContaining('doručené pošty'));
    expect(hint.getAttribute('aria-label')).toContain('e-mailu vidět není');
  });

  /**
   * Plochu e-mailu kreslí role `surface.canvas` a `surface.content`, nic jiného.
   * Motiv míval na tutéž barvu ještě pole `canvasBackground` a `contentBackground`,
   * jenže je nečetl nikdo, takže volba v panelu nezměnila ani plátno, ani
   * odeslaný e-mail. Tenhle test hlídá, že panel píše do role, ne vedle ní.
   */
  it('pozadí plátna zapíše barvu do role surface.canvas', async () => {
    const store = setup();
    const palette = screen.getByTestId('color-palette-surface.canvas');
    await userEvent.click(within(palette).getByRole('button', { name: /^Hlavní barva značky / }));
    const theme = store.getState().document.theme;
    expect(theme.colors['surface.canvas']).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme).not.toHaveProperty('canvasBackground');
  });

  it('do role se ukládá odstín, ne název role', async () => {
    const store = setup();
    const palette = screen.getByTestId('color-palette-surface.content');
    await userEvent.click(within(palette).getByRole('button', { name: /^Hlavní barva značky / }));
    // `resolveTheme` by název role vydal beze změny a do e-mailu by šlo
    // „brand.primary" místo barvy.
    expect(store.getState().document.theme.colors['surface.content']).not.toBe('brand.primary');
  });
});
