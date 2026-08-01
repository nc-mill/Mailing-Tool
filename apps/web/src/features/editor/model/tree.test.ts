import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import { blockAt, canContain, childrenOf, findBlock, flatten, typeAt } from './tree';

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
      ],
    },
    { id: 'b_s2', type: 'section', props: {}, children: [] },
  ],
} as unknown as EditorDocument;

describe('tree', () => {
  it('najde blok a jeho cestu', () => {
    expect(findBlock(doc, 'b_t1')?.path).toEqual([0, 1, 0, 0]);
    expect(findBlock(doc, 'b_s2')?.path).toEqual([1]);
    expect(findBlock(doc, 'b_x')).toBeUndefined();
  });

  it('vrací blok podle cesty a typ podle cesty', () => {
    expect(blockAt(doc, [0, 1])?.id).toBe('b_c1');
    expect(typeAt(doc, [])).toBe('$root');
    expect(typeAt(doc, [0, 1, 0])).toBe('column');
  });

  it('vrací potomky, kořen jako pole sekcí', () => {
    expect(childrenOf(doc, []).map((b) => b.id)).toEqual(['b_s1', 'b_s2']);
    expect(childrenOf(doc, [0, 1]).map((b) => b.id)).toEqual(['b_col1', 'b_col2']);
  });

  it('zplošťuje strom v pořadí, ve kterém se kreslí, s úrovní a pozicí', () => {
    const flat = flatten(doc);
    expect(flat.map((i) => i.block.id)).toEqual([
      'b_s1',
      'b_h1',
      'b_c1',
      'b_col1',
      'b_t1',
      'b_col2',
      'b_s2',
    ]);
    expect(flat[0]).toMatchObject({ level: 1, index: 0, siblings: 2 });
    expect(flat.find((i) => i.block.id === 'b_t1')).toMatchObject({
      level: 4,
      index: 0,
      siblings: 1,
    });
  });

  it('vynucuje gramatiku vnořování z části 3, 3.1.2', () => {
    expect(canContain('$root', 'section')).toBe(true);
    expect(canContain('$root', 'heading')).toBe(false);
    expect(canContain('section', 'columns')).toBe(true);
    expect(canContain('section', 'column')).toBe(false);
    expect(canContain('section', 'section')).toBe(false);
    expect(canContain('columns', 'column')).toBe(true);
    expect(canContain('columns', 'text')).toBe(false);
    expect(canContain('column', 'columns')).toBe(false); // pravidlo S2
    expect(canContain('column', 'text')).toBe(true);
    expect(canContain('repeat', 'text')).toBe(true);
    expect(canContain('repeat', 'repeat')).toBe(false); // pravidlo S15
    expect(canContain('text', 'text')).toBe(false);
    expect(canContain('section', 'neznamy')).toBe(false);
  });
});
