import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
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

function setup() {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}>
        <ThemePanel />
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
});
