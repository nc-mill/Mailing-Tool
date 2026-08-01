import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../src/document/defaults';
import { DocumentSchemaTooNewError, loadDocument, MIGRATIONS } from '../../src/document/migrate';

const doc = (version: number) => ({
  schemaVersion: version,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [],
});

describe('loadDocument', () => {
  it('returns the current version untouched', () => {
    const input = doc(1);
    expect(loadDocument(input)).toEqual(input);
  });

  it('throws a typed error for a newer schema version', () => {
    expect(() => loadDocument(doc(2))).toThrow(DocumentSchemaTooNewError);
    try {
      loadDocument(doc(3));
    } catch (error) {
      expect((error as DocumentSchemaTooNewError).code).toBe('template_schema_too_new');
      expect((error as DocumentSchemaTooNewError).documentVersion).toBe(3);
      expect((error as DocumentSchemaTooNewError).supportedVersion).toBe(1);
    }
  });

  it('rejects a value that is not an object with a numeric schemaVersion', () => {
    expect(() => loadDocument(null)).toThrow(/schemaVersion/);
    expect(() => loadDocument({ schemaVersion: '1' })).toThrow(/schemaVersion/);
  });

  it('has no migrations yet and they form a contiguous chain when added', () => {
    let expected = 1;
    for (const migration of MIGRATIONS) {
      expect(migration.from).toBe(expected);
      expect(migration.to).toBe(expected + 1);
      expected += 1;
    }
  });

  it('does not mutate its input', () => {
    const input = doc(1);
    const copy = structuredClone(input);
    loadDocument(input);
    expect(input).toEqual(copy);
  });
});
