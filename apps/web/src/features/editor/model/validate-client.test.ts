import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import { blockIdAtPointer } from './validate-client';

const doc = {
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {},
  blocks: [
    {
      id: 'b_s1',
      type: 'section',
      props: {},
      children: [
        { id: 'b_h1', type: 'heading', props: { content: [] } },
        {
          id: 'b_c1',
          type: 'columns',
          props: {},
          children: [
            {
              id: 'b_col1',
              type: 'column',
              props: {},
              children: [{ id: 'b_img1', type: 'image', props: { alt: '' } }],
            },
          ],
        },
      ],
    },
  ],
} as unknown as EditorDocument;

describe('blockIdAtPointer', () => {
  it.each([
    ['/blocks/0', 'b_s1'],
    ['/blocks/0/props/padding', 'b_s1'],
    ['/blocks/0/children/0/props/content', 'b_h1'],
    ['/blocks/0/children/1/children/0/children/0/props/alt', 'b_img1'],
    ['/blocks/0/children/1/children/0', 'b_col1'],
  ])('z %s najde blok %s', (pointer, expected) => {
    expect(blockIdAtPointer(doc, pointer)).toBe(expected);
  });

  it.each([['/theme/colors'], ['/meta/name'], [''], ['/blocks/9/props/x']])(
    'u %s nevrátí nic, místo aby uhádl blok',
    (pointer) => {
      // Nález na motivu nebo na hlavičce k žádnému bloku nepatří. Kdyby se
      // vrátil nejbližší blok, proklik by uživatele poslal někam, kde nic není.
      expect(blockIdAtPointer(doc, pointer)).toBeUndefined();
    },
  );
});
