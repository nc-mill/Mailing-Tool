import { describe, expect, it } from 'vitest';
import { CONTENT_TYPES } from '../model/document-types';
import { BLOCK_DESCRIPTORS, descriptorFor, PALETTE, paletteFor } from './registry';

const typesIn = (groups: ReturnType<typeof paletteFor>): string[] =>
  groups.flatMap((group) => group.entries.map((entry) => entry.type));

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

  it('paleta veřejné stránky nenabídne patičku ani syrové HTML', () => {
    // Patička s odhlašovacím odkazem nemá na stránce koho odhlašovat.
    // Blok HTML je bezpečnostní rozhodnutí: stránka běží na naší doméně,
    // takže vložený obsah v ní může předstírat cizí značku (plán, oddíl 4.4).
    const types = typesIn(paletteFor('page'));
    expect(types).not.toContain('footer');
    expect(types).not.toContain('html');
  });

  it('paleta veřejné stránky nabídne všechny ostatní bloky', () => {
    // Druhá půlka zákazu: zúžení se nesmí zvrhnout v „na stránce skoro nic".
    const types = typesIn(paletteFor('page'));
    for (const type of ['heading', 'text', 'button', 'image', 'divider', 'spacer', 'social']) {
      expect(types, type).toContain(type);
    }
    expect(types).toContain('section');
    expect(types.filter((type) => type === 'columns')).toHaveLength(2);
  });

  it('paleta kampaně a transakční šablony se nezměnila ani o položku', () => {
    // Ochrana proti tomu, aby zúžení stránky mlčky ubralo bloky i e-mailům.
    // Porovnává se totožnost objektu, ne obsah: kdyby se paleta pro e-mail
    // začala skládat znovu, prošel by tenhle případ i s odebranou položkou.
    expect(paletteFor('campaign')).toBe(PALETTE);
    expect(paletteFor('transactional')).toBe(PALETTE);
    expect(typesIn(paletteFor('campaign'))).toContain('footer');
    expect(typesIn(paletteFor('campaign'))).toContain('html');
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
