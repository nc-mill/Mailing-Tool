import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../model/document-types';
import { createEditorStore } from '../state/editor-store';
import { runOperation } from './run-operation';

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
        children: [
          { id: 'b_h1', type: 'heading', props: {} },
          { id: 'b_t1', type: 'text', props: {} },
          {
            id: 'b_c1',
            type: 'columns',
            props: {},
            children: [
              { id: 'b_col1', type: 'column', props: {}, children: [] },
              { id: 'b_col2', type: 'column', props: {}, children: [] },
            ],
          },
        ],
      },
    ],
  }) as unknown as EditorDocument;

const store = () => {
  const s = createEditorStore({ document: doc(), designHash: 'h1' });
  s.select('b_h1');
  return s;
};

describe('runOperation', () => {
  it('posun dolů oznámí typ bloku a novou pozici, kritérium 54', () => {
    const s = store();
    const result = runOperation(s, 'move-down');
    expect(result.announce).toEqual({
      key: 'a11y.blockMoved',
      params: { block: 'block.heading', position: 2, total: 3 },
    });
    expect(s.getState().document.blocks[0]!.children!.map((b) => b.id)).toEqual([
      'b_t1',
      'b_h1',
      'b_c1',
    ]);
  });

  it('na kraji úrovně oznámí důrazně, že dál to nejde, a dokument nezmění', () => {
    const s = store();
    const before = s.getState().document;
    const result = runOperation(s, 'move-up');
    // `tone: 'assertive'` není kosmetika. Zdvořilá oblast oznámení zařadí za
    // to, co čtečka právě čte, takže uživatel na kraji seznamu mačká klávesu
    // dál a nedozví se, že narazil.
    expect(result.announce).toEqual({
      key: 'a11y.moveBlocked',
      params: { block: 'block.heading' },
      tone: 'assertive',
    });
    expect(s.getState().document).toBe(before);
  });

  it('úspěšný přesun se hlásí zdvořile, aby nepřerušil čtení', () => {
    const s = store();
    expect(runOperation(s, 'move-down').announce?.tone).toBeUndefined();
  });

  it('zasunutí do sloupce oznámí pozici uvnitř sloupce', () => {
    const s = store();
    s.select('b_t1');
    const result = runOperation(s, 'move-in');
    expect(result.announce).toEqual({
      key: 'a11y.blockMoved',
      params: { block: 'block.text', position: 1, total: 1 },
    });
  });

  it('duplikace vybere kopii a oznámí to', () => {
    const s = store();
    const result = runOperation(s, 'duplicate');
    expect(s.getState().selectedId).not.toBe('b_h1');
    expect(result.announce?.key).toBe('a11y.blockDuplicated');
  });

  it('smazání vrátí popis pro nabídku vrácení akce', () => {
    const s = store();
    const result = runOperation(s, 'delete');
    expect(result.undo).toBe(true);
    expect(s.getState().document.blocks[0]!.children).toHaveLength(2);
  });

  it('šipka dolů posune výběr na další blok v pořadí kreslení', () => {
    const s = store();
    runOperation(s, 'select-next');
    expect(s.getState().selectedId).toBe('b_t1');
    runOperation(s, 'select-next');
    runOperation(s, 'select-next');
    expect(s.getState().selectedId).toBe('b_col1');
  });

  it('šipka doleva vybere rodiče, doprava prvního potomka', () => {
    const s = store();
    s.select('b_col1');
    runOperation(s, 'select-parent');
    expect(s.getState().selectedId).toBe('b_c1');
    runOperation(s, 'select-child');
    expect(s.getState().selectedId).toBe('b_col1');
  });

  it('bez vybraného bloku se nic nestane a nic se neoznámí', () => {
    const s = store();
    s.select(null);
    expect(runOperation(s, 'move-down')).toEqual({});
  });
});
