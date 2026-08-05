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

  it('ukazuje počet chyb v ICU tvaru', () => {
    setup([{ code: 'liquid_unknown_field', severity: 'error', blockId: 'b_t1' }]);
    expect(screen.getByText(/1 chyba/)).toBeInTheDocument();
  });

  it('o varováních v souhrnu nemluví, ani slovem „žádné"', () => {
    setup([{ code: 'liquid_unknown_field', severity: 'error', blockId: 'b_t1' }]);
    expect(screen.queryByText(/varování/i)).toBeNull();
  });

  it('známý kód přeloží z katalogu, i když klient žádnou větu nedostal', () => {
    // Klientská validace vrací kód a parametry, ne hotovou větu. Kdyby se
    // spoléhalo na `message`, ukázal by se uživateli holý kód.
    setup([{ code: 'content_missing_unsubscribe', severity: 'error', blockId: 'b_t1' }]);
    expect(screen.getByText(/odkaz na odhlášení/)).toBeInTheDocument();
  });

  it('kliknutí na nález vybere blok, kterého se týká', async () => {
    const store = setup([
      { code: 'content_missing_unsubscribe', severity: 'error', blockId: 'b_t1' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: /odkaz na odhlášení/ }));
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

  /*
   * Rozhodnutí zadavatele: „Chyby tam nech, ale upozornění nechci zobrazovat
   * žádné." Hlavní filtr sedí na vstupu do stavu (`use-validation.ts`), tyhle
   * testy hlídají pojistku v samotném pruhu, protože komponentu jde vykreslit
   * i s ručně dodanými nálezy, přesně jak to dělá `setup` nad nimi.
   */
  it('varování se nevykreslí vůbec, ani jako řádek', () => {
    setup([{ code: 'content_low_contrast', severity: 'warning', blockId: 'b_t1' }]);
    expect(screen.queryByRole('region', { name: /Nálezy/ })).toBeNull();
    expect(screen.queryByText(/špatně čitelný/)).toBeNull();
  });

  it('mezi samými varováními nezůstane ani odkaz Přejít na blok', () => {
    setup([
      { code: 'content_low_contrast', severity: 'warning', blockId: 'b_t1' },
      { code: 'content_image_missing_alt', severity: 'warning', blockId: 'b_t1' },
    ]);
    expect(screen.queryByText(/Přejít na blok/)).toBeNull();
  });

  it('vedle chyby se varování nezapočítá do počtu ani nevypíše', () => {
    setup([
      { code: 'liquid_unknown_field', severity: 'error', blockId: 'b_t1' },
      { code: 'content_low_contrast', severity: 'warning', blockId: 'b_t1' },
      { code: 'content_image_missing_alt', severity: 'warning', blockId: 'b_t1' },
    ]);
    // Jedna chyba, ne „1 chyba, 2 varování".
    expect(screen.getByText(/1 chyba/)).toBeInTheDocument();
    expect(screen.queryByText(/špatně čitelný/)).toBeNull();
    expect(screen.queryByText(/Obrázek nemá popis/)).toBeNull();
  });

  it('nález typu info se taky nevykreslí, protože chyba to není', () => {
    setup([{ code: 'teapot', severity: 'info', message: 'Jen tak pro informaci.' }]);
    expect(screen.queryByRole('region', { name: /Nálezy/ })).toBeNull();
  });

  it('zastaralý nález ze serveru se ukáže, ale řekne o sobě pravdu', () => {
    setup([
      {
        code: 'precheck_app_url_not_public',
        severity: 'error',
        message: 'Adresa aplikace není veřejná.',
        stale: true,
      },
    ]);

    // Neschovává se: chyba ze serveru se nesmí ztratit jen proto, že uživatel
    // něco upravil. Jen se u ní řekne, že o té úpravě ještě neví.
    expect(screen.getByText(/Adresa aplikace není veřejná/)).toBeInTheDocument();
    expect(screen.getByTestId('issue-stale')).toHaveTextContent(/po uložení se přepočítá/);
  });

  it('čerstvý nález popisek o zastaralosti nemá', () => {
    setup([{ code: 'liquid_unknown_field', severity: 'error', blockId: 'b_t1' }]);
    expect(screen.queryByTestId('issue-stale')).toBeNull();
  });
});
