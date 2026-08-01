import { describe, expect, it } from 'vitest';
import { BLOCK_ID_PATTERN } from './document-types';
import { createBlock, createFromPaletteEntry } from './factory';

describe('factory', () => {
  it('vytvoří blok s identifikátorem podle vzoru a s výchozími hodnotami z descriptoru', () => {
    const block = createBlock('heading');
    expect(block.id).toMatch(BLOCK_ID_PATTERN);
    expect(block.type).toBe('heading');
    expect(block.props.level).toBe(2);
    expect(block.props.fontWeight).toBe(700);
  });

  it('sekce dostane prázdné pole potomků', () => {
    expect(createBlock('section').children).toEqual([]);
  });

  it('dvousloupcový blok dostane dva sloupce, třísloupcový tři', () => {
    expect(createBlock('columns').children).toHaveLength(2);
    expect(createBlock('columns', { layout: '1-1-1' }).children).toHaveLength(3);
    expect(createBlock('columns', { layout: '2-1-1' }).children).toHaveLength(3);
  });

  it('sloupce mají navzájem různé identifikátory', () => {
    const block = createBlock('columns');
    const ids = block.children!.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('položka palety s předvolbou ji vloží do vlastností', () => {
    const block = createFromPaletteEntry({
      id: 'columns-3',
      type: 'columns',
      label: 'block.columns3',
      icon: 'columns3',
      preset: { layout: '1-1-1' },
    });
    expect(block.props.layout).toBe('1-1-1');
    expect(block.children).toHaveLength(3);
  });

  it('neznámý typ vytvořit nejde', () => {
    expect(() => createBlock('carousel')).toThrow(/unknown block type/);
  });
});
