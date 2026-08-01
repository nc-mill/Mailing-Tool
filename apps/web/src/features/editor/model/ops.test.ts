import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import {
  countBlocks,
  duplicateBlock,
  insertBlock,
  moveBlock,
  patchProps,
  removeBlock,
  setVisibility,
} from './ops';
import { findBlock } from './tree';

const base = (): EditorDocument =>
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
          { id: 'b_h1', type: 'heading', props: { level: 2 } },
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

let counter = 0;
const gen = () => `b_fixed${String((counter += 1)).padStart(6, '0')}`;

describe('ops', () => {
  it('vloží blok na zadané místo a původní dokument nezmění', () => {
    const doc = base();
    const next = insertBlock(doc, [0], 1, { id: 'b_new', type: 'divider', props: {} });
    expect(next.blocks[0]!.children?.map((b) => b.id)).toEqual(['b_h1', 'b_new', 'b_t1', 'b_c1']);
    expect(doc.blocks[0]!.children).toHaveLength(3);
  });

  it('odmítne vložení, které porušuje gramatiku', () => {
    expect(() =>
      insertBlock(base(), [0, 2, 0], 0, { id: 'b_x', type: 'columns', props: {} }),
    ).toThrow(/content_nested_columns/);
  });

  it('odebere blok a vrátí ho i s cestou', () => {
    const result = removeBlock(base(), 'b_t1');
    expect(result?.removed.id).toBe('b_t1');
    expect(result?.path).toEqual([0, 1]);
    expect(findBlock(result!.doc, 'b_t1')).toBeUndefined();
  });

  it('přesune blok dolů ve stejné úrovni a srovná index po odebrání', () => {
    const next = moveBlock(base(), 'b_h1', { parent: [0], index: 2 });
    expect(next?.blocks[0]!.children?.map((b) => b.id)).toEqual(['b_t1', 'b_h1', 'b_c1']);
  });

  it('přesune blok do sloupce', () => {
    const next = moveBlock(base(), 'b_h1', { parent: [0, 2, 0], index: 0 });
    expect(findBlock(next!, 'b_h1')?.path).toEqual([0, 1, 0, 0]);
  });

  it('odmítne přesun do vlastního podstromu', () => {
    expect(moveBlock(base(), 'b_c1', { parent: [0, 2, 0], index: 0 })).toBeNull();
  });

  it('odmítne přesun, který porušuje gramatiku', () => {
    expect(moveBlock(base(), 'b_c1', { parent: [0, 2, 0], index: 0 })).toBeNull();
    expect(moveBlock(base(), 'b_h1', { parent: [], index: 0 })).toBeNull();
  });

  it('duplikuje podstrom s novými identifikátory a vloží ho hned za původní', () => {
    counter = 0;
    const result = duplicateBlock(base(), 'b_c1', gen);
    const ids = result!.doc.blocks[0]!.children!.map((b) => b.id);
    expect(ids).toEqual(['b_h1', 'b_t1', 'b_c1', 'b_fixed000001']);
    const copy = findBlock(result!.doc, 'b_fixed000001')!.block;
    expect(copy.children!.map((c) => c.id)).toEqual(['b_fixed000002', 'b_fixed000003']);
  });

  it('nedovolí duplikovat patičku, protože dokument smí mít jen jednu', () => {
    const doc = insertBlock(base(), [0], 0, { id: 'b_f1', type: 'footer', props: {} });
    expect(duplicateBlock(doc, 'b_f1', gen)).toBeNull();
  });

  it('mění vlastnosti bez dotyku ostatních bloků', () => {
    const next = patchProps(base(), 'b_h1', { level: 1, align: 'center' });
    expect(findBlock(next, 'b_h1')?.block.props).toEqual({ level: 1, align: 'center' });
    expect(findBlock(next, 'b_t1')?.block.props).toEqual({});
  });

  it('nastaví a zruší podmínku zobrazení', () => {
    const withCond = setVisibility(base(), 'b_t1', { field: 'contact.city', op: 'present' });
    expect(findBlock(withCond, 'b_t1')?.block.visibleWhen).toEqual({
      field: 'contact.city',
      op: 'present',
    });
    const without = setVisibility(withCond, 'b_t1', null);
    expect(findBlock(without, 'b_t1')?.block.visibleWhen).toBeNull();
  });

  it('podmínku na patičce odmítne, pravidlo S14', () => {
    const doc = insertBlock(base(), [0], 0, { id: 'b_f1', type: 'footer', props: {} });
    expect(() => setVisibility(doc, 'b_f1', { field: 'contact.city', op: 'present' })).toThrow(
      /content_condition_on_unsubscribe/,
    );
  });

  it('spočítá bloky včetně vnořených', () => {
    expect(countBlocks(base())).toBe(6);
  });
});
