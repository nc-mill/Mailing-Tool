import messages from '@mlain/i18n/messages/cs/editor.json';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '@mlain/emails/theme/resolve';
import { themeWithDefaults, type EditorDocument } from '../../model/document-types';
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
  it('pozadí plátna zapíše volbu do role surface.canvas', async () => {
    const store = setup();
    const palette = screen.getByTestId('color-palette-surface.canvas');
    await userEvent.click(within(palette).getByRole('button', { name: /^Hlavní barva značky / }));
    const theme = store.getState().document.theme;
    expect(theme.colors['surface.canvas']).toBe('brand.primary');
    expect(theme).not.toHaveProperty('canvasBackground');
  });

  /**
   * VOLBA ROLE JE VAZBA, NE ZMRAZENÝ ODSTÍN.
   *
   * Panel dřív odkaz na roli rozřešil na odstín hned při volbě, takže „pozadí
   * plátna = hlavní barva značky" po změně značky projektu zůstalo staré.
   * Uživatel volbou řekl vazbu, ne barvu, a tenhle test hlídá oba směry:
   * role se přebarví, vlastní odstín zůstane.
   */
  it('role se po změně značky přebarví, vlastní odstín zůstane', async () => {
    const store = setup();
    await userEvent.click(
      within(screen.getByTestId('color-palette-surface.canvas')).getByRole('button', {
        name: /^Hlavní barva značky /,
      }),
    );
    // `input type="color"` se psát nedá, hodnotu do něj dosazuje systémový výběr.
    fireEvent.change(
      within(screen.getByTestId('color-palette-surface.content')).getByLabelText('Vlastní barva'),
      { target: { value: '#123456' } },
    );

    const before = resolveTheme(themeWithDefaults(store.getState().document.theme));
    expect(before.light.roles['surface.canvas']).toBe(before.light.roles['brand.primary']);
    expect(before.light.roles['surface.content']).toBe('#123456');

    // Přesně to, co s dokumentem udělá převlečení do nové značky projektu.
    store.patchTheme({
      colors: { ...store.getState().document.theme.colors, 'brand.primary': '#ff0000' },
    });

    const after = resolveTheme(themeWithDefaults(store.getState().document.theme));
    expect(after.light.roles['surface.canvas']).toBe('#ff0000');
    expect(after.light.roles['surface.content']).toBe('#123456');
  });

  /**
   * TMAVÝ REŽIM UŽ NEPŘEBÍJÍ ZVOLENÉ POZADÍ BEZ MOŽNOSTI ZÁSAHU.
   *
   * Emitter vydá u strategie `auto` pravidlo `.ml-canvas{...!important}` z tmavé
   * palety, takže barva zvolená ve světlé mapě je v tmavém režimu nevidět.
   * Mechanismus na tmavou variantu (`theme.darkMode.colors`) existoval, jen ho
   * panel nenabízel. Tyhle tři testy hlídají všechny tři poloviny opravy: že se
   * pole nabízí, že píše do tmavé mapy (a ne do světlé) a že vzorník kreslí
   * tmavé odstíny.
   */
  const enableDarkMode = async () =>
    userEvent.selectOptions(screen.getByLabelText(/Tmavý režim/), 'auto');

  it('plochy tmavého režimu se nabízejí jen u zapnutého tmavého režimu', async () => {
    setup();
    // Výchozí dokument tu tmavý režim zapnutý nemá, pole tedy nesvítí naprázdno.
    expect(screen.queryByTestId('color-palette-dark:surface.canvas')).toBeNull();
    await enableDarkMode();
    expect(screen.getByTestId('color-palette-dark:surface.canvas')).toBeInTheDocument();
    expect(screen.getByTestId('color-palette-dark:surface.content')).toBeInTheDocument();
  });

  it('volba tmavé plochy jde do darkMode.colors, světlou nechá být', async () => {
    const store = setup();
    await enableDarkMode();
    fireEvent.change(
      within(screen.getByTestId('color-palette-dark:surface.canvas')).getByLabelText(
        'Vlastní barva',
      ),
      { target: { value: '#102030' } },
    );

    const theme = store.getState().document.theme;
    expect(theme.darkMode?.colors['surface.canvas']).toBe('#102030');
    // Strategie se zápisem barvy neztratila a světlá mapa zůstala nedotčená.
    expect(theme.darkMode?.strategy).toBe('auto');
    expect(theme.colors?.['surface.canvas']).toBeUndefined();

    const resolved = resolveTheme(themeWithDefaults(theme));
    expect(resolved.dark.roles['surface.canvas']).toBe('#102030');
    expect(resolved.light.roles['surface.canvas']).not.toBe('#102030');
  });

  /**
   * Vzorník tmavého pole musí kreslit TMAVÉ odstíny. Se světlými by uživatel
   * klikl na téměř bílé plátno a příjemce by dostal skoro černé, tedy vzorek by
   * ukazoval jinou barvu, než jakou volba nastaví.
   */
  it('vzorník tmavé plochy ukazuje tmavé odstíny, ne světlé', async () => {
    setup();
    await enableDarkMode();
    const resolved = resolveTheme(themeWithDefaults({ contentWidth: 600 } as never));

    const swatch = within(screen.getByTestId('color-palette-dark:surface.canvas')).getByRole(
      'button',
      { name: /^Plátno / },
    );
    expect(swatch.getAttribute('aria-label')).toContain(resolved.dark.roles['surface.canvas']);
    expect(swatch.getAttribute('aria-label')).not.toContain(resolved.light.roles['surface.canvas']);
  });
});
