import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { CZECH_SCORE_TABLE, decodeSample, detectEncoding, scoreCandidate } from './encoding';
import { importErrorCode } from './errors';

const czech =
  'Email;Jméno\njana@firma.cz;Jana Nováková\npetr@firma.cz;Petr Šťastný\nlucie@x.cz;Lucie Žáková\n';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return importErrorCode(error);
  }
}

describe('encoding detection', () => {
  it('detects utf-8 with BOM and strips it', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(czech, 'utf8')]);
    const out = detectEncoding(buf);
    expect(out).toEqual({ encoding: 'utf-8', source: 'bom', bomLength: 3 });
    expect(decodeSample(buf, out).startsWith('Email')).toBe(true);
  });

  it('rejects utf-16 and utf-32 with unsupported_encoding', () => {
    for (const bom of [
      [0xff, 0xfe],
      [0xfe, 0xff],
      [0xff, 0xfe, 0x00, 0x00],
      [0x00, 0x00, 0xfe, 0xff],
    ]) {
      expect(codeOf(() => detectEncoding(Buffer.from([...bom, 0x41])))).toBe(
        'unsupported_encoding',
      );
    }
  });

  it('detects plain utf-8 without a BOM', () => {
    expect(detectEncoding(Buffer.from(czech, 'utf8'))).toMatchObject({
      encoding: 'utf-8',
      source: 'utf8_validation',
    });
  });

  it('detects pure ascii as utf-8', () => {
    expect(detectEncoding(Buffer.from('a;b\n1;2\n', 'ascii'))).toMatchObject({ encoding: 'utf-8' });
  });

  it('picks windows-1250 for real CP1250 data, not windows-1252', () => {
    const buf = iconv.encode(czech, 'windows-1250');
    expect(detectEncoding(buf)).toMatchObject({ encoding: 'windows-1250', source: 'score' });
  });

  it('picks iso-8859-2 for real ISO-8859-2 data, not iso-8859-1', () => {
    const buf = iconv.encode(czech, 'iso-8859-2');
    expect(detectEncoding(buf)).toMatchObject({ encoding: 'iso-8859-2', source: 'score' });
  });

  it('scores by czech letters minus symbol noise', () => {
    expect(scoreCandidate('áčďéěíň')).toBe(14);
    expect(scoreCandidate('¡¢£')).toBe(-9);
    expect(CZECH_SCORE_TABLE.positive).toContain('ř');
  });

  it('breaks a tie in favour of windows-1250', () => {
    const ascii = Buffer.from('name;city\njan;praha\n', 'ascii');
    const out = detectEncoding(ascii);
    expect(out.encoding).toBe('utf-8');
  });

  it('truncates the sample at the last complete code point', () => {
    const buf = Buffer.concat([Buffer.from('á'.repeat(10), 'utf8'), Buffer.from([0xc3])]);
    expect(() => detectEncoding(buf)).not.toThrow();
    expect(detectEncoding(buf).encoding).toBe('utf-8');
  });
});
