import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock, VarInline } from '../../src/document/types';
import {
  assignFilterSlots,
  filterSlotMarker,
  RawSlotSink,
  RAW_SLOT_PREFIX,
} from '../../src/normalize/slots';

const textBlock = (id: string, nodes: VarInline[]) => ({
  id,
  type: 'text' as const,
  props: { ...blockDefaults('text'), content: [{ t: 'p' as const, children: nodes }] },
});

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: 'b_000000000001',
      type: 'section',
      props: blockDefaults('section'),
      children,
    } as unknown as SectionBlock,
  ],
});

describe('filter slots', () => {
  it('numbers slots in document order starting at one', () => {
    const doc = docOf([
      textBlock('b_000000000002', [{ t: 'var', expr: 'contact.first_name', fallback: 'kolego' }]),
      textBlock('b_000000000003', [
        { t: 'var', expr: 'contact.first_name', fallback: 'zákazníku' },
      ]),
    ]);
    const slots = assignFilterSlots(doc);
    expect(slots).toEqual([
      { slot: 1, blockId: 'b_000000000002', filter: 'default', value: 'kolego' },
      { slot: 2, blockId: 'b_000000000003', filter: 'default', value: 'zákazníku' },
    ]);
  });

  it('writes the slot number onto the node so the emitter never guesses', () => {
    const doc = docOf([textBlock('b_000000000002', [{ t: 'var', expr: 'x', fallback: 'y' }])]);
    assignFilterSlots(doc);
    const node = (doc.blocks[0]!.children[0] as ReturnType<typeof textBlock>).props.content[0]!
      .children[0] as VarInline;
    expect(node.slots).toEqual({ default: 1 });
  });

  it('gives a node with both filters two slots', () => {
    const doc = docOf([
      textBlock('b_000000000002', [
        {
          t: 'var',
          expr: 'contact.created_at | date | default',
          fallback: 'brzy',
          dateFormat: '%d.%m.%Y',
        },
      ]),
    ]);
    const slots = assignFilterSlots(doc);
    expect(slots.map((s) => s.filter)).toEqual(['default', 'date']);
    const node = (doc.blocks[0]!.children[0] as ReturnType<typeof textBlock>).props.content[0]!
      .children[0] as VarInline;
    expect(node.slots).toEqual({ default: 1, date: 2 });
  });

  it('skips nodes without any filter argument', () => {
    const doc = docOf([textBlock('b_000000000002', [{ t: 'var', expr: 'contact.email' }])]);
    expect(assignFilterSlots(doc)).toEqual([]);
  });

  it('renders markers with four digits and only characters no react renderer escapes', () => {
    expect(filterSlotMarker(7)).toBe('ML_ARG_0007');
    expect(filterSlotMarker(1234)).toBe('ML_ARG_1234');
    expect(filterSlotMarker(7)).toMatch(/^[A-Z_0-9]+$/);
  });
});

describe('raw slots', () => {
  it('returns a marker that survives react escaping and resolves back to the raw html', () => {
    const sink = new RawSlotSink('ab12cd34ef');
    const marker = sink.add('<!--[if mso]><table><![endif]-->');
    expect(marker).toBe(`${RAW_SLOT_PREFIX}ab12cd34ef_0001`);
    expect(marker).toMatch(/^[A-Z_0-9a-z]+$/);
    expect(sink.entries()).toEqual([[marker, '<!--[if mso]><table><![endif]-->']]);
  });

  it('numbers markers in the order they were requested', () => {
    const sink = new RawSlotSink('ab12cd34ef');
    expect(sink.add('a')).toBe(`${RAW_SLOT_PREFIX}ab12cd34ef_0001`);
    expect(sink.add('b')).toBe(`${RAW_SLOT_PREFIX}ab12cd34ef_0002`);
  });

  it('generates a fresh ten character nonce when none is given', () => {
    const a = new RawSlotSink();
    const b = new RawSlotSink();
    expect(a.nonce).toMatch(/^[a-z0-9]{10}$/);
    expect(a.nonce).not.toBe(b.nonce);
  });
});
