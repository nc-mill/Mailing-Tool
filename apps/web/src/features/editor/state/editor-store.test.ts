import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../model/document-types';
import { createEditorStore } from './editor-store';

const doc = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: '', language: 'cs' },
    theme: {},
    blocks: [
      {
        id: 'b_s1',
        type: 'section',
        props: {},
        children: [{ id: 'b_h1', type: 'heading', props: { level: 2 } }],
      },
    ],
  }) as unknown as EditorDocument;

const gen = (() => {
  let n = 0;
  return () => `b_gen${String((n += 1)).padStart(8, '0')}`;
})();

describe('editor store', () => {
  it('začíná bez rozdělané změny a bez výběru', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    expect(store.getState().selectedId).toBeNull();
    expect(store.getState().isDirty).toBe(false);
  });

  it('oznámí odběratele při změně', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    store.select('b_h1');
    stop();
    store.select(null);
    expect(calls).toBe(1);
  });

  it('vloží blok, vybere ho a označí dokument za rozdělaný', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1', generateId: gen });
    const id = store.insertBlock('text', { parent: [0], index: 1 });
    expect(store.getState().selectedId).toBe(id);
    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().document.blocks[0]!.children).toHaveLength(2);
  });

  it('vrátí a znovu provede poslední akci včetně výběru', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1', generateId: gen });
    store.select('b_h1');
    store.patchProps('b_h1', { level: 1 });
    store.undo();
    expect(store.getState().document.blocks[0]!.children![0]!.props.level).toBe(2);
    expect(store.getState().selectedId).toBe('b_h1');
    store.redo();
    expect(store.getState().document.blocks[0]!.children![0]!.props.level).toBe(1);
  });

  it('smazání jde vrátit i po změně výběru', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1', generateId: gen });
    store.removeBlock('b_h1');
    expect(store.getState().document.blocks[0]!.children).toHaveLength(0);
    store.undo();
    expect(store.getState().document.blocks[0]!.children![0]!.id).toBe('b_h1');
  });

  it('historie má strop a nejstarší krok zahazuje', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1', historyLimit: 3 });
    for (let i = 0; i < 5; i += 1) store.patchProps('b_h1', { level: (i % 3) + 1 });
    expect(store.getState().historyDepth).toBe(3);
  });

  it('po uložení zmizí rozdělaná změna a uloží se nový otisk', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    store.patchProps('b_h1', { level: 1 });
    store.markSaved('h2', 1_760_000_000_000);
    expect(store.getState().isDirty).toBe(false);
    expect(store.getState().designHash).toBe('h2');
    expect(store.getState().savedAt).toBe(1_760_000_000_000);
  });

  it('převzetí cizí verze při konfliktu vymaže historii', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    store.patchProps('b_h1', { level: 1 });
    // Verze ze serveru: uložená je, protože odtamtud přišla.
    store.replaceDocument(doc(), 'h9', { saved: true });
    expect(store.getState().historyDepth).toBe(0);
    expect(store.getState().isDirty).toBe(false);
    expect(store.getState().designHash).toBe('h9');
  });

  /**
   * Návrh od AI je NEULOŽENÁ změna. Dokud se značil jako uložený, automatické
   * ukládání se po jeho vložení nespustilo a práce se po znovunačtení ztratila.
   */
  it('vložený návrh je neuložená změna, jinak se nikdy neuloží', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    store.replaceDocument(doc(), 'h1');
    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().historyDepth).toBe(0);
  });

  it('po uložení návrhu už není co ukládat', () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    store.replaceDocument(doc(), 'h1');
    store.markSaved('h2', 1_760_000_000_000);
    expect(store.getState().isDirty).toBe(false);
  });

  it('návrat k původnímu dokumentu po uložení návrhu se taky uloží', () => {
    const original = doc();
    const store = createEditorStore({ document: original, designHash: 'h1' });
    // Vložení návrhu a jeho uložení.
    store.replaceDocument(doc(), 'h1');
    store.markSaved('h2', 1_760_000_000_000);
    // „Zkusit jinak" vrátí původní dokument. Na serveru je ale návrh, takže
    // původní obsah je zase neuložená změna a musí se zapsat zpátky.
    store.replaceDocument(original, 'h2');
    expect(store.getState().isDirty).toBe(true);
  });
});
