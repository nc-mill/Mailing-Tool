import { describe, expect, it } from 'vitest';
import { detectDialect } from './dialect';
import { importErrorCode } from './errors';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return importErrorCode(error);
  }
}

describe('dialect detection', () => {
  it('prefers the semicolon, because czech excel exports with it', () => {
    const out = detectDialect('a;b;c\n1;2;3\n4;5;6\n');
    expect(out).toMatchObject({
      delimiter: ';',
      hasHeader: true,
      quoteChar: '"',
      escape: 'double',
    });
  });

  it('detects a comma when the semicolon does not split', () => {
    expect(detectDialect('a,b,c\n1,2,3\n').delimiter).toBe(',');
  });

  it('detects a tab and a pipe', () => {
    expect(detectDialect('a\tb\n1\t2\n').delimiter).toBe('\t');
    expect(detectDialect('a|b\n1|2\n').delimiter).toBe('|');
  });

  it('respects quotes when counting fields', () => {
    expect(detectDialect('a;b\n"x;y";2\n"p;q";3\n').delimiter).toBe(';');
  });

  it('throws delimiter_not_detected when the mode is below two', () => {
    expect(codeOf(() => detectDialect('just one line of prose\nand another\n'))).toBe(
      'delimiter_not_detected',
    );
  });

  it('switches to backslash escaping when the sample has it and no doubled quotes', () => {
    expect(detectDialect('a;b\n"x\\"y";2\n').escape).toBe('backslash');
  });

  it('says there is no header when the first row is numeric', () => {
    expect(detectDialect('1;2;3\n4;5;6\n').hasHeader).toBe(false);
  });

  it('says there is no header when a name repeats', () => {
    expect(detectDialect('a;a;b\n1;2;3\n').hasHeader).toBe(false);
  });

  it('accepts mixed line endings', () => {
    expect(detectDialect('a;b\r\n1;2\n3;4\r').delimiter).toBe(';');
  });
});
