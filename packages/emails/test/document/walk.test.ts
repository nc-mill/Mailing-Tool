import { describe, expect, it } from 'vitest';
import type { Document } from '../../src/document/types';
import { walkBlocks, walkRichText } from '../../src/document/walk';
import { DEFAULT_THEME } from '../../src/document/defaults';
import { blockDefaults } from '../../src/document/defaults';

const doc: Document = {
  schemaVersion: 1,
  meta: { name: 't', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: 'b_000000000001',
      type: 'section',
      props: blockDefaults('section'),
      children: [
        {
          id: 'b_000000000002',
          type: 'columns',
          props: blockDefaults('columns'),
          children: [
            {
              id: 'b_000000000003',
              type: 'column',
              props: blockDefaults('column'),
              children: [{ id: 'b_000000000004', type: 'spacer', props: blockDefaults('spacer') }],
            },
            {
              id: 'b_000000000005',
              type: 'column',
              props: blockDefaults('column'),
              children: [],
            },
          ],
        },
        { id: 'b_000000000006', type: 'divider', props: blockDefaults('divider') },
      ],
    },
  ],
};

describe('walkBlocks', () => {
  it('visits blocks depth first in document order', () => {
    const seen = [...walkBlocks(doc)].map((entry) => entry.block.id);
    expect(seen).toEqual([
      'b_000000000001',
      'b_000000000002',
      'b_000000000003',
      'b_000000000004',
      'b_000000000005',
      'b_000000000006',
    ]);
  });

  it('reports a JSON pointer for every block', () => {
    const pointers = [...walkBlocks(doc)].map((entry) => entry.pointer);
    expect(pointers[0]).toBe('/blocks/0');
    expect(pointers[3]).toBe('/blocks/0/children/0/children/0/children/0');
    expect(pointers[5]).toBe('/blocks/0/children/1');
  });

  it('reports depth so nesting rules can be checked in one pass', () => {
    const depths = [...walkBlocks(doc)].map((entry) => entry.depth);
    expect(depths).toEqual([0, 1, 2, 3, 2, 1]);
  });
});

describe('walkRichText', () => {
  it('visits inline nodes in reading order with pointers', () => {
    const rich = [
      {
        t: 'p' as const,
        children: [
          { t: 's' as const, v: 'a' },
          { t: 'var' as const, expr: 'contact.city' },
        ],
      },
      { t: 'ul' as const, items: [[{ t: 's' as const, v: 'b' }]] },
    ];
    const seen = [...walkRichText(rich, '/x')].map((e) => [e.pointer, e.node.t]);
    expect(seen).toEqual([
      ['/x/0/children/0', 's'],
      ['/x/0/children/1', 'var'],
      ['/x/1/items/0/0', 's'],
    ]);
  });

  it('descends into link children', () => {
    const rich = [
      {
        t: 'p' as const,
        children: [
          {
            t: 'a' as const,
            href: 'https://a.cz',
            children: [{ t: 'var' as const, expr: 'contact.city' }],
          },
        ],
      },
    ];
    const seen = [...walkRichText(rich, '/y')].map((e) => e.pointer);
    expect(seen).toEqual(['/y/0/children/0', '/y/0/children/0/children/0']);
  });
});
