import { describe, expect, it } from 'vitest';
import { wrapPlain } from '../../src/text/wrap';

describe('wrapPlain', () => {
  it('wraps on a word boundary at 78 characters', () => {
    const line = 'slovo '.repeat(30).trim();
    for (const out of wrapPlain(line)) expect(out.length).toBeLessThanOrEqual(78);
  });

  it('never splits a liquid expression', () => {
    const line = `${'a'.repeat(70)} {{ contact.first_name_vocative }} konec`;
    const out = wrapPlain(line);
    expect(out.some((l) => l.includes('{{ contact.first_name_vocative }}'))).toBe(true);
    expect(out.join('\n')).not.toMatch(/\{\{[^}]*\n/);
  });

  it('keeps an over long token on its own line rather than cutting it', () => {
    const long = 'x'.repeat(120);
    expect(wrapPlain(`start ${long} end`)).toEqual(['start', long, 'end']);
  });

  it('returns a single empty line for empty input', () => {
    expect(wrapPlain('')).toEqual(['']);
  });

  it('keeps an indent on continuation lines when asked', () => {
    const out = wrapPlain('slovo '.repeat(30).trim(), { indent: '  ' });
    expect(out[0]!.startsWith('  ')).toBe(false);
    expect(out[1]!.startsWith('  ')).toBe(true);
  });
});
