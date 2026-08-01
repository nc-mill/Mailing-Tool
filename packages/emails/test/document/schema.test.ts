import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import { validateDocumentSchema } from '../../src/document/schema';

const base = () => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: 'P', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: 'b_000000000001',
      type: 'section',
      props: blockDefaults('section'),
      children: [{ id: 'b_000000000002', type: 'text', props: blockDefaults('text') }],
    },
  ],
});

describe('document json schema', () => {
  it('accepts a minimal valid document', () => {
    expect(validateDocumentSchema(base())).toEqual({ ok: true });
  });

  it('rejects an unknown top level property', () => {
    const doc = { ...base(), extra: 1 };
    const result = validateDocumentSchema(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.pointer).toBe('');
  });

  it('rejects a malformed block id and points at it', () => {
    const doc = base();
    doc.blocks[0]!.id = 'nope';
    const result = validateDocumentSchema(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.pointer).toBe('/blocks/0/id');
  });

  it('accepts an unknown block type and keeps its extra properties', () => {
    const doc = base();
    (doc.blocks[0]!.children as unknown[]).push({
      id: 'b_000000000003',
      type: 'chart',
      series: [1, 2, 3],
      nested: { deep: true },
    });
    expect(validateDocumentSchema(doc)).toEqual({ ok: true });
  });

  it('still reports a concrete error for a broken known block', () => {
    const doc = base();
    (doc.blocks[0]!.children[0] as { props: { fontSize: unknown } }).props.fontSize = 'big';
    const result = validateDocumentSchema(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.pointer.includes('/props/fontSize'))).toBe(true);
    }
  });

  it('accepts the repeat block even though MVP 0 never emits it', () => {
    const doc = base();
    (doc.blocks[0]!.children as unknown[]).push({
      id: 'b_000000000004',
      type: 'repeat',
      props: { ...blockDefaults('repeat'), path: 'contact.attr.items' },
      children: [],
    });
    expect(validateDocumentSchema(doc)).toEqual({ ok: true });
  });

  it('rejects a var node carrying the internal slots property', () => {
    const doc = base();
    (doc.blocks[0]!.children[0] as { props: { content: unknown } }).props.content = [
      { t: 'p', children: [{ t: 'var', expr: 'contact.city', slots: { default: 3 } }] },
    ];
    expect(validateDocumentSchema(doc).ok).toBe(false);
  });

  it('rejects a document with more than sixty sections', () => {
    const doc = base();
    doc.blocks = Array.from({ length: 61 }, (_, i) => ({
      id: `b_00000000${String(i).padStart(4, '0')}`,
      type: 'section' as const,
      props: blockDefaults('section'),
      children: [],
    }));
    expect(validateDocumentSchema(doc).ok).toBe(false);
  });
});
