import { describe, expect, it } from 'vitest';
import { ImportOptionsSchema, assertOptionsConsistent, defaultOptions } from './options';
import { importErrorCode } from './errors';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return importErrorCode(error);
  }
}

describe('import options', () => {
  it('defaults to the least destructive choice', () => {
    const out = defaultOptions();
    expect(out.on_conflict).toBe('update');
    expect(out.duplicate_in_file).toBe('last');
    expect(out.skip_suppressed).toBe(true);
    expect(out.subscription_status).toBe('pending');
  });

  it('rejects an unknown key instead of silently using a default', () => {
    expect(() => ImportOptionsSchema.parse({ ...defaultOptions(), on_conflct: 'skip' })).toThrow();
  });

  it('requires a declaration for confirmed status on a double opt-in list', () => {
    const opts = {
      ...defaultOptions(),
      subscription_status: 'confirmed' as const,
      list_ids: ['l1'],
    };
    expect(codeOf(() => assertOptionsConsistent(opts, { doubleOptInListIds: ['l1'] }))).toBe(
      'declaration_required',
    );
  });

  it('accepts confirmed status when the declaration is given', () => {
    const opts = {
      ...defaultOptions(),
      subscription_status: 'confirmed' as const,
      list_ids: ['l1'],
      consent: {
        purpose: 'email_marketing' as const,
        legal_basis: 'consent' as const,
        source: 'import',
        declaration: true,
      },
    };
    expect(() => assertOptionsConsistent(opts, { doubleOptInListIds: ['l1'] })).not.toThrow();
  });

  it('forbids turning off suppression skipping for complaints', () => {
    const opts = { ...defaultOptions(), skip_suppressed: false };
    expect(assertOptionsConsistent(opts, { doubleOptInListIds: [] }).alwaysSkippedReasons).toEqual([
      'complaint',
      'gdpr_erasure',
    ]);
  });

  it('disables duplicate_in_file error above the memory threshold', () => {
    const opts = { ...defaultOptions(), duplicate_in_file: 'error' as const };
    expect(
      codeOf(() =>
        assertOptionsConsistent(opts, {
          doubleOptInListIds: [],
          estimatedRows: 2_000_000,
          inMemoryDedupMaxRows: 1_000_000,
        }),
      ),
    ).toBe('duplicate_error_unavailable');
  });
});
