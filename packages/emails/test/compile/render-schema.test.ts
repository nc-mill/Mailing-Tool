import { describe, expect, it } from 'vitest';
import type { FieldCatalog } from '../../src/external/field-catalog';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, SectionBlock } from '../../src/document/types';
import { buildRenderSchema } from '../../src/compile/render-schema';

const catalog: FieldCatalog = {
  version: 'v1',
  fields: [
    {
      path: 'greeting',
      type: 'string',
      label: { en: 'Greeting' },
      group: 'salutation',
      deleted: false,
    },
    { path: 'attr.city', type: 'string', label: { en: 'City' }, group: 'custom', deleted: false },
    { path: 'attr.is_vip', type: 'boolean', label: { en: 'VIP' }, group: 'custom', deleted: false },
    {
      path: 'created_at',
      type: 'datetime',
      label: { en: 'Created' },
      group: 'meta',
      deleted: false,
    },
  ],
};

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

const textWith = (id: string, children: unknown[], visibleWhen?: unknown) => ({
  id,
  type: 'text',
  visibleWhen,
  props: { ...blockDefaults('text'), content: [{ t: 'p', children }] },
});

const run = (children: unknown[]) =>
  buildRenderSchema(docOf(children), { fields: catalog, skippedBlockIds: new Set() });

describe('buildRenderSchema', () => {
  it('lists exactly the contact paths that the document outputs', () => {
    const schema = run([
      textWith('b_000000000002', [
        { t: 'var', expr: 'contact.greeting' },
        { t: 'var', expr: 'contact.attr.city | upcase' },
      ]),
    ]);
    expect(schema.fields.map((f) => f.path)).toEqual(['contact.greeting', 'contact.attr.city']);
    expect(schema.fields.every((f) => f.required === false)).toBe(true);
  });

  it('resolves the type from the field catalog', () => {
    const schema = run([
      textWith('b_000000000002', [{ t: 'var', expr: 'contact.created_at | date' }]),
    ]);
    expect(schema.fields[0]).toEqual({
      path: 'contact.created_at',
      type: 'datetime',
      required: false,
    });
  });

  it('puts a condition only field into presence and not into fields', () => {
    const schema = run([
      textWith('b_000000000002', [{ t: 's', v: 'Jsme i u vás' }], {
        field: 'contact.attr.city',
        op: 'present',
      }),
    ]);
    expect(schema.presence).toEqual(['contact.attr.city']);
    expect(schema.fields).toEqual([]);
  });

  it('puts a field used both ways into both lists', () => {
    const schema = run([
      textWith('b_000000000002', [{ t: 'var', expr: 'contact.attr.city' }], {
        field: 'contact.attr.city',
        op: 'present',
      }),
    ]);
    expect(schema.fields.map((f) => f.path)).toEqual(['contact.attr.city']);
    expect(schema.presence).toEqual(['contact.attr.city']);
  });

  it('puts a boolean condition into fields, because it needs no presence map', () => {
    const schema = run([
      textWith('b_000000000002', [{ t: 's', v: 'VIP' }], {
        field: 'contact.attr.is_vip',
        op: 'true',
      }),
    ]);
    expect(schema.presence).toEqual([]);
    expect(schema.fields.map((f) => f.path)).toEqual(['contact.attr.is_vip']);
  });

  it('collects system tags from hrefs and from the footer switches', () => {
    const schema = run([{ id: 'b_000000000002', type: 'footer', props: blockDefaults('footer') }]);
    expect(schema.systemTags.sort()).toEqual(['preferences_url', 'unsubscribe_url', 'webview_url']);
  });

  it('keeps campaign and workspace roots out of presence but inside fields', () => {
    const schema = run([
      textWith('b_000000000002', [{ t: 'var', expr: 'workspace.sender_address' }]),
    ]);
    expect(schema.fields.map((f) => f.path)).toEqual(['workspace.sender_address']);
    expect(schema.fields[0]!.type).toBe('string');
  });

  it('flattens everything into usedPaths without duplicates', () => {
    const schema = run([
      textWith('b_000000000002', [{ t: 'var', expr: 'contact.attr.city' }], {
        field: 'contact.attr.city',
        op: 'present',
      }),
      { id: 'b_000000000003', type: 'footer', props: blockDefaults('footer') },
    ]);
    expect(new Set(schema.usedPaths).size).toBe(schema.usedPaths.length);
    expect(schema.usedPaths).toContain('contact.attr.city');
    expect(schema.usedPaths).toContain('unsubscribe_url');
  });

  it('has no loops in MVP 0 because repeat is never emitted', () => {
    expect(run([]).renderSchema.loops).toEqual([]);
  });
});
