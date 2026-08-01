import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import { moveDelta, moveIn, moveOut } from './moves';

const doc: EditorDocument = {
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
        {
          id: 'b_c1',
          type: 'columns',
          props: {},
          children: [
            {
              id: 'b_col1',
              type: 'column',
              props: {},
              children: [{ id: 'b_t1', type: 'text', props: {} }],
            },
            { id: 'b_col2', type: 'column', props: {}, children: [] },
          ],
        },
        { id: 'b_d1', type: 'divider', props: {} },
      ],
    },
    { id: 'b_s2', type: 'section', props: {}, children: [] },
  ],
} as unknown as EditorDocument;

describe('moves', () => {
  it('posune blok o jednu pozici mezi sourozenci', () => {
    expect(moveDelta(doc, 'b_h1', 1)).toEqual({ parent: [0], index: 1 });
    expect(moveDelta(doc, 'b_d1', -1)).toEqual({ parent: [0], index: 1 });
  });

  it('na kraji úrovně vrátí null, aby šlo oznámit, že to nejde', () => {
    expect(moveDelta(doc, 'b_h1', -1)).toBeNull();
    expect(moveDelta(doc, 'b_d1', 1)).toBeNull();
    expect(moveDelta(doc, 'b_t1', 1)).toBeNull();
  });

  it('vysune blok ze sloupce do sekce, hned za blok se sloupci', () => {
    expect(moveOut(doc, 'b_t1')).toEqual({ parent: [0], index: 2 });
  });

  it('sekci vysunout nejde, kořen jiné sekce nepobere', () => {
    expect(moveOut(doc, 'b_s1')).toBeNull();
    expect(moveOut(doc, 'b_h1')).toBeNull();
  });

  it('zasune blok do posledního sloupce předchozího sourozence', () => {
    expect(moveIn(doc, 'b_d1')).toEqual({ parent: [0, 1, 1], index: 0 });
  });

  it('zasune blok do prvního sloupce následujícího sourozence, když předchozí není', () => {
    expect(moveIn(doc, 'b_h1')).toEqual({ parent: [0, 1, 0], index: 1 });
  });

  it('když sousední blok není kontejner, zasunout nejde', () => {
    expect(moveIn(doc, 'b_t1')).toBeNull();
    expect(moveIn(doc, 'b_s2')).toBeNull();
  });
});
