import { describe, expect, it } from 'vitest';
import type { CompileMeta, RenderSchema } from '@mlain/emails/compile/types';
import { ApiError } from '../../errors/api-error';
import {
  assertCompileMetaMatches,
  computeCompiledHash,
  isStoredCompileMeta,
  normalizeCompileOutput,
  renderPlanFrom,
  type StoredCompileMeta,
} from '../compile';

const renderSchema: RenderSchema = {
  version: 1,
  fields: [{ path: 'contact.first_name', type: 'string', required: false }],
  systemTags: ['unsubscribe_url'],
  presence: ['contact.attr.city'],
  loops: [],
};

function meta(overrides: Partial<CompileMeta> = {}): CompileMeta {
  return {
    contractVersion: 1,
    rendererVersion: 'r1.0.0',
    schemaVersion: 1,
    usedPaths: ['contact.first_name'],
    renderSchema,
    links: [
      {
        id: '2f1e5c8a-3b7d-5e41-9a02-000000000001',
        position: 1,
        url: 'https://a.cz',
        trackable: true,
        label: 'A',
      },
    ],
    assetIds: [],
    htmlBytes: 10,
    textBytes: 5,
    warnings: [],
    hasUnsubscribeLink: true,
    clickMarkerCount: 2,
    hasOpenPixelSlot: true,
    ...overrides,
  } as CompileMeta;
}

const source = { design: { version: 1 }, subject: 'Předmět', preheader: 'Preheader' };
const compiled = { html: '<p>ok</p>', text: 'ok' };

function stored(overrides: Partial<StoredCompileMeta> = {}): StoredCompileMeta {
  return { ...normalizeCompileOutput(meta(), compiled, source).compileMeta, ...overrides };
}

describe('normalizeCompileOutput', () => {
  it('vezme z CompileMeta jen to, co nekdo dalsi cte za behu', () => {
    const result = normalizeCompileOutput(meta(), compiled, source);
    expect(Object.keys(result.compileMeta).sort()).toEqual([
      'clickMarkerCount',
      'contractVersion',
      'hasUnsubscribeLink',
      'links',
      'renderSchema',
      'rendererVersion',
      'usedPaths',
    ]);
  });

  it('jina verze kontraktu je contract_mismatch, ne tiche prijeti', () => {
    expect(() =>
      normalizeCompileOutput(meta({ contractVersion: 2 as 1 }), compiled, source),
    ).toThrowError(ApiError);
  });

  it('odkaz bez id je contract_mismatch: P13 ID nedopocitava (D17)', () => {
    const broken = meta({
      links: [{ id: '', position: 1, url: 'https://a.cz', trackable: true, label: 'A' }],
    });
    expect(() => normalizeCompileOutput(broken, compiled, source)).toThrowError(
      /contract_mismatch/,
    );
  });

  it('pozice nula je contract_mismatch: pozice zacinaji od jedne', () => {
    const broken = meta({
      links: [{ id: 'x', position: 0, url: 'https://a.cz', trackable: true, label: 'A' }],
    });
    expect(() => normalizeCompileOutput(broken, compiled, source)).toThrowError(
      /contract_mismatch/,
    );
  });

  it('min znacek nez trackovanych odkazu je contract_mismatch', () => {
    expect(() =>
      normalizeCompileOutput(meta({ clickMarkerCount: 0 }), compiled, source),
    ).toThrowError(/contract_mismatch/);
  });

  it('netrackovany odkaz znacku mit nemusi, takze nerovnost projde', () => {
    const withMailto = meta({
      links: [
        {
          id: '2f1e5c8a-3b7d-5e41-9a02-000000000001',
          position: 1,
          url: 'https://a.cz',
          trackable: true,
          label: 'A',
        },
        {
          id: '2f1e5c8a-3b7d-5e41-9a02-000000000002',
          position: 2,
          url: 'mailto:a@b.cz',
          trackable: false,
          label: 'Mail',
        },
      ],
      clickMarkerCount: 1,
    });
    expect(() => normalizeCompileOutput(withMailto, compiled, source)).not.toThrow();
  });
});

describe('computeCompiledHash', () => {
  it('stejny vstup da stejny hash, kompilace je deterministicka', () => {
    expect(computeCompiledHash(source)).toBe(computeCompiledHash({ ...source }));
  });

  it('zmena predmetu hash zmeni, preflight tim pozna zmenu po kompilaci', () => {
    expect(computeCompiledHash(source)).not.toBe(
      computeCompiledHash({ ...source, subject: 'Jiny' }),
    );
  });
});

describe('assertCompileMetaMatches', () => {
  it('chybejici ulozena metadata jsou rozpor, ne prazdna shoda', () => {
    expect(() => assertCompileMetaMatches(null, stored())).toThrowError(/contract_mismatch/);
  });

  it('shodne odkazy projdou', () => {
    expect(() => assertCompileMetaMatches(stored(), stored())).not.toThrow();
  });

  it('rozejita ID odkazu se hlasi, nikdy netoleruji (D17)', () => {
    const jina = stored({
      links: [
        {
          id: '2f1e5c8a-3b7d-5e41-9a02-00000000000f',
          position: 1,
          url: 'https://a.cz',
          trackable: true,
          label: 'A',
        },
      ],
    });
    expect(() => assertCompileMetaMatches(stored(), jina)).toThrowError(/contract_mismatch/);
  });

  it('jiny pocet znacek se hlasi taky', () => {
    expect(() => assertCompileMetaMatches(stored(), stored({ clickMarkerCount: 5 }))).toThrowError(
      /contract_mismatch/,
    );
  });
});

describe('renderPlanFrom', () => {
  it('renderSchema prochazi zuzovaci funkci, nikdy pretypovanim', () => {
    let seen: RenderSchema | null = null;
    const plan = renderPlanFrom(stored(), (schema) => {
      seen = schema;
      return { fields: ['contact.first_name'], presence: ['contact.attr.city'] };
    });
    expect(seen).toBe(renderSchema);
    expect(plan.usedPaths).toEqual(['contact.first_name']);
    expect(plan.preparedSchema.presence).toEqual(['contact.attr.city']);
  });
});

describe('isStoredCompileMeta', () => {
  it('null neprojde', () => {
    expect(isStoredCompileMeta(null)).toBe(false);
  });

  it('metadata bez renderSchema neprojdou: _present by zustalo prazdne (R11)', () => {
    expect(isStoredCompileMeta({ usedPaths: [], links: [] })).toBe(false);
  });

  it('uplna metadata projdou', () => {
    expect(isStoredCompileMeta(stored())).toBe(true);
  });
});
