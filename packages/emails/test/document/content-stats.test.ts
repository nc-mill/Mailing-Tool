import { describe, expect, it } from 'vitest';
import {
  contentStateOf,
  countContentBlocks,
  hasContentBlocks,
  CONTENT_BLOCK_TYPES,
  NON_CONTENT_BLOCK_TYPES,
} from '../../src/document/content-stats';
import { blockDefaults, DEFAULT_THEME, KNOWN_BLOCK_TYPES } from '../../src/document/defaults';
import type { Document, SectionBlock, SectionChild } from '../../src/document/types';

function doc(children: SectionChild[]): Document {
  return {
    schemaVersion: 1,
    meta: { name: 'Kampaň', previewText: 'Náhled', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children,
      } as SectionBlock,
    ],
  };
}

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };
const text = { id: 'b_000000000010', type: 'text', props: blockDefaults('text') };

describe('počítání obsahu dokumentu', () => {
  it('dokument, ve kterém není nic než patička, nemá žádný obsah', () => {
    expect(countContentBlocks(doc([footer as SectionChild]))).toBe(0);
    expect(hasContentBlocks(doc([footer as SectionChild]))).toBe(false);
    expect(contentStateOf(doc([footer as SectionChild]))).toBe('empty');
  });

  it('čára ani mezera obsah nedělá', () => {
    const filler = doc([
      { id: 'b_1', type: 'divider', props: blockDefaults('divider') },
      { id: 'b_2', type: 'spacer', props: blockDefaults('spacer') },
      footer,
    ] as SectionChild[]);
    expect(contentStateOf(filler)).toBe('empty');
  });

  it('jediný text stačí', () => {
    expect(countContentBlocks(doc([text, footer] as SectionChild[]))).toBe(1);
    expect(contentStateOf(doc([text, footer] as SectionChild[]))).toBe('ok');
  });

  it('obsah zanořený ve sloupcích se počítá taky', () => {
    const columns = doc([
      {
        id: 'b_cols',
        type: 'columns',
        props: blockDefaults('columns'),
        children: [
          {
            id: 'b_col1',
            type: 'column',
            props: blockDefaults('column'),
            children: [{ id: 'b_img', type: 'image', props: blockDefaults('image') }],
          },
          {
            id: 'b_col2',
            type: 'column',
            props: blockDefaults('column'),
            children: [{ id: 'b_btn', type: 'button', props: blockDefaults('button') }],
          },
        ],
      },
      footer,
    ] as SectionChild[]);
    expect(countContentBlocks(columns)).toBe(2);
  });

  it('chybějící dokument se pozná od prázdného', () => {
    expect(contentStateOf(null)).toBe('missing');
    expect(contentStateOf(undefined)).toBe('missing');
    expect(contentStateOf({ meta: {} })).toBe('missing');
    expect(contentStateOf(doc([footer as SectionChild]))).toBe('empty');
  });

  it('rozbitý tvar nepadá, počítá se jako nula', () => {
    expect(countContentBlocks('{}')).toBe(0);
    expect(countContentBlocks(42)).toBe(0);
  });

  it('každý známý typ bloku je zařazený právě jednou', () => {
    const both = [...CONTENT_BLOCK_TYPES, ...NON_CONTENT_BLOCK_TYPES];
    expect([...both].sort()).toEqual([...KNOWN_BLOCK_TYPES].sort());
    expect(new Set(both).size).toBe(both.length);
  });
});
