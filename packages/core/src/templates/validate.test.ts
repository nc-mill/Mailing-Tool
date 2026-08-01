import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { FieldCatalog } from '../contacts/fields/catalog';
import { validateTemplateDocument } from './validate';

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
  ],
};

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };

const doc = (children: unknown[] = [footer]) => ({
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [{ id: 'b_000000000001', type: 'section', props: blockDefaults('section'), children }],
});

const ctx = { templateKind: 'campaign' as const, fields: catalog, assetIds: new Set<string>() };

describe('validateTemplateDocument', () => {
  it('accepts a valid document and reports state valid', () => {
    const result = validateTemplateDocument(doc(), ctx);
    expect(result.state).toBe('valid');
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('stops at the schema layer and does not run semantics on a broken shape', () => {
    const result = validateTemplateDocument({ schemaVersion: 1 }, ctx);
    expect(result.state).toBe('invalid');
    expect(result.issues.every((i) => i.code.startsWith('schema_'))).toBe(true);
  });

  it('reports a too new schema version with its own code', () => {
    const result = validateTemplateDocument({ ...doc(), schemaVersion: 2 }, ctx);
    expect(result.issues.map((i) => i.code)).toContain('template_schema_too_new');
  });

  it('keeps warnings out of the blocking decision', () => {
    const withoutAlt = {
      id: 'b_000000000002',
      type: 'image',
      props: { ...blockDefaults('image'), assetId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071' },
    };
    const result = validateTemplateDocument(doc([withoutAlt, footer]), {
      ...ctx,
      assetIds: new Set(['0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071']),
    });
    expect(result.issues.some((i) => i.code === 'content_image_missing_alt')).toBe(true);
    expect(result.state).toBe('valid');
  });

  it('marks a document referencing an unknown field as invalid', () => {
    const text = {
      id: 'b_000000000002',
      type: 'text',
      props: {
        ...blockDefaults('text'),
        content: [{ t: 'p', children: [{ t: 'var', expr: 'contact.neexistuje' }] }],
      },
    };
    expect(validateTemplateDocument(doc([text, footer]), ctx).state).toBe('invalid');
  });

  it('returns dotted paths for the api envelope, not json pointers', () => {
    const duplicate = doc([footer, { ...footer, id: 'b_000000000099' }]);
    const result = validateTemplateDocument(duplicate, ctx);
    const issue = result.issues.find((i) => i.code === 'content_duplicate_block_id');
    expect(issue?.path).toMatch(/^blocks\.0\.children\./);
  });
});
