import { describe, expect, it } from 'vitest';
import { CONTENT_TYPES } from '../model/document-types';
import { BLOCK_DESCRIPTORS, descriptorFor, PALETTE } from './registry';

describe('registry', () => {
  it('má descriptor pro každý známý typ bloku kromě repeat', () => {
    const types = Object.keys(BLOCK_DESCRIPTORS).sort();
    expect(types).toEqual([...CONTENT_TYPES, 'column', 'columns', 'section'].sort());
  });

  it('paleta neobsahuje repeat ani column, kritérium 8d části 3', () => {
    const types = PALETTE.flatMap((group) => group.entries.map((e) => e.type));
    expect(types).not.toContain('repeat');
    expect(types).not.toContain('column');
  });

  it('každá položka palety odkazuje na existující descriptor', () => {
    for (const group of PALETTE) {
      for (const entry of group.entries) expect(BLOCK_DESCRIPTORS[entry.type]).toBeDefined();
    }
  });

  it('dvousloupcový a třísloupcový blok jsou dvě položky nad jedním typem', () => {
    const columns = PALETTE.flatMap((g) => g.entries).filter((e) => e.type === 'columns');
    expect(columns.map((e) => e.preset?.layout)).toEqual(['1-1', '1-1-1']);
  });

  it('neznámý typ dostane zamčený descriptor bez vlastností', () => {
    const unknown = descriptorFor('carousel');
    expect(unknown.inPalette).toBe(false);
    expect(unknown.groups).toEqual([]);
    expect(unknown.label).toBe('block.unknown');
  });

  it('patička nemá skupinu podmínky zobrazení, pravidlo S14', () => {
    const keys = BLOCK_DESCRIPTORS.footer!.groups.flatMap((g) => g.props.map((p) => p.key));
    expect(keys).not.toContain('visibleWhen');
  });

  it('blok html má vlastnost chráněnou oprávněním', () => {
    const code = BLOCK_DESCRIPTORS.html!.groups[0]!.props[0];
    expect(code).toMatchObject({
      kind: 'code',
      permission: 'templates:write_html',
      maxLength: 20000,
    });
  });
});
