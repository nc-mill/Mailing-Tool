import messages from '@mlain/i18n/messages/cs/editor.json';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../../model/document-types';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import { IssueBar } from './issue-bar';

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
        children: [{ id: 'b_t1', type: 'text', props: {} }],
      },
    ],
  }) as unknown as EditorDocument;

function setup(issues: Parameters<ReturnType<typeof createEditorStore>['setIssues']>[0]) {
  const store = createEditorStore({ document: document(), designHash: 'h1' });
  store.setIssues(issues);
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: messages }}>
      <EditorStoreProvider value={store}>
        <IssueBar />
      </EditorStoreProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

describe('IssueBar', () => {
  it('bez nálezů se nezobrazuje', () => {
    setup([]);
    expect(screen.queryByRole('region', { name: /Nálezy/ })).toBeNull();
  });

  it('ukazuje počty chyb a varování v ICU tvaru včetně nuly', () => {
    setup([{ code: 'liquid_unknown_field', severity: 'error', blockId: 'b_t1' }]);
    expect(screen.getByText(/1 chyba/)).toBeInTheDocument();
    expect(screen.getByText(/žádné varování/i)).toBeInTheDocument();
  });

  it('známý kód přeloží z katalogu, i když klient žádnou větu nedostal', () => {
    // Klientská validace vrací kód a parametry, ne hotovou větu. Kdyby se
    // spoléhalo na `message`, ukázal by se uživateli holý `content_low_contrast`.
    setup([{ code: 'content_low_contrast', severity: 'warning', blockId: 'b_t1' }]);
    expect(screen.getByText(/špatně čitelný/)).toBeInTheDocument();
  });

  it('kliknutí na nález vybere blok, kterého se týká', async () => {
    const store = setup([
      { code: 'content_image_missing_alt', severity: 'warning', blockId: 'b_t1' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: /Obrázek nemá popis/ }));
    expect(store.getState().selectedId).toBe('b_t1');
  });

  it('u neznámého kódu zobrazí detail ze serveru, ne prázdno, kritérium 76 části 6', () => {
    setup([{ code: 'teapot', severity: 'error', message: 'Neznámý stav.' }]);
    expect(screen.getByText(/Neznámý stav/)).toBeInTheDocument();
  });

  it('u neznámého kódu bez detailu zobrazí aspoň kód, ne prázdný řádek', () => {
    setup([{ code: 'teapot', severity: 'error' }]);
    expect(screen.getByText('teapot')).toBeInTheDocument();
  });
});
