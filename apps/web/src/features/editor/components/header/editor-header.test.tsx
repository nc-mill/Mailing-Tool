import type { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csEditor from '@mlain/i18n/messages/cs/editor.json';
import { createEditorStore } from '../../state/editor-store';
import { EditorStoreProvider } from '../../state/use-editor';
import type { EditorDocument } from '../../model/document-types';
import { EditorHeader } from './editor-header';

/**
 * Ukládání je jediná věc, kterou uživatel v editoru NESMÍ ztratit z dohledu.
 *
 * Vada, kvůli které tenhle soubor vznikl: automatické ukládání se po vložení
 * návrhu od AI vůbec nespustilo, hlavička proto zůstala prázdná a v UI nebylo
 * nic, čím uložit ručně. Uživatel přišel o práci a neměl jak to poznat.
 */
const doc = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: 'P', language: 'cs' },
    theme: {},
    blocks: [],
  }) as unknown as EditorDocument;

const wrap = (ui: ReactNode, store: ReturnType<typeof createEditorStore>) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ editor: csEditor }} timeZone="Europe/Prague">
      <EditorStoreProvider value={store}>{ui}</EditorStoreProvider>
    </NextIntlClientProvider>,
  );

const header = (
  store: ReturnType<typeof createEditorStore>,
  onSave = vi.fn(),
  readOnly = false,
) => {
  wrap(
    <EditorHeader
      mode="edit"
      onMode={vi.fn()}
      onTestSend={vi.fn()}
      onSave={onSave}
      readOnly={readOnly}
    />,
    store,
  );
  return onSave;
};

describe('ukládání v hlavičce editoru', () => {
  it('tlačítko Uložit v editoru existuje', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeInTheDocument();
  });

  it('bez neuložené změny je Uložit vypnuté, ať neslibuje něco, co neudělá', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeDisabled();
  });

  it('po vložení návrhu je Uložit aktivní a v hlavičce stojí Neuložené změny', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    // Přesně to dělá panel AI asistenta, když vloží návrh do editoru.
    act(() => store.replaceDocument(doc(), 'h1'));
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeEnabled();
    expect(screen.getByTestId('save-status')).toHaveTextContent('Neuložené změny');
  });

  it('kliknutí na Uložit spustí zápis', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const onSave = header(store);
    act(() => store.replaceDocument(doc(), 'h1'));
    screen.getByRole('button', { name: 'Uložit' }).click();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('během ukládání je tlačítko vypnuté, aby nešlo poslat dva zápisy', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store);
    act(() => store.replaceDocument(doc(), 'h1'));
    act(() => store.setStatus('saving'));
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeDisabled();
  });

  it('v režimu jen pro čtení se Uložit nenabízí', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    header(store, vi.fn(), true);
    expect(screen.queryByRole('button', { name: 'Uložit' })).not.toBeInTheDocument();
  });
});

/**
 * VĚTA ZE SERVERU U ODMÍTNUTÉHO ULOŽENÍ.
 *
 * Doménové závory seznamu (potvrzovací e-mail bez odkazu na potvrzení,
 * odhlašovací odkaz v uvítacím a rozloučovacím e-mailu) vracejí 422 s celou
 * instrukcí, co má autor opravit. Do téhle chvíle z ní v hlavičce zbylo obecné
 * „dokument je neplatný", takže se člověk v editoru neměl podle čeho zařídit.
 */
describe('hlavička u odmítnutého uložení', () => {
  const SERVER_SENTENCE =
    'Tenhle e-mail je připojený jako potvrzovací, takže musí obsahovat odkaz na potvrzení.';

  it('ukáže větu ze serveru místo obecné hlášky', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h' });
    header(store);

    act(() => store.setStatus('invalid', SERVER_SENTENCE));

    expect(screen.getByTestId('save-status')).toHaveTextContent(SERVER_SENTENCE);
  });

  it('bez věty ze serveru zůstane obecná hláška', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h' });
    header(store);

    act(() => store.setStatus('invalid'));

    expect(screen.getByTestId('save-status')).toHaveTextContent(csEditor.header.saveInvalid);
  });

  it('po úspěšném uložení věta zmizí', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h' });
    header(store);

    act(() => store.setStatus('invalid', SERVER_SENTENCE));
    act(() => store.markSaved('h2', Date.now()));

    expect(screen.getByTestId('save-status')).not.toHaveTextContent(SERVER_SENTENCE);
  });
});
