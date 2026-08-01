import { describe, expect, it } from 'vitest';
import { isDisposableDomain, loadDisposableDomains, maskEmail, normalizeEmail } from '../email';

describe('normalizeEmail', () => {
  it.each([
    ['jan@x.cz', 'jan@x.cz'],
    ['  jan@x.cz  ', 'jan@x.cz'],
    ['<jan@x.cz>', 'jan@x.cz'],
    ['JAN@X.CZ', 'jan@x.cz'],
    ['Jan.Novak+news@Example.COM', 'jan.novak+news@example.com'],
    ['jan@háčkyčárky.cz', 'jan@xn--hkyrky-ptac70bc.cz'],
  ])('normalizuje %s na %s', (input, expected) => {
    const result = normalizeEmail(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe(expected);
  });

  it('rozbalí tvar s display jménem a vrátí jméno zvlášť', () => {
    expect(normalizeEmail('Jan Novák <jan@x.cz>')).toEqual({
      ok: true,
      email: 'jan@x.cz',
      displayName: 'Jan Novák',
    });
  });

  it('nevrátí displayName, když tam žádné není', () => {
    const result = normalizeEmail('jan@x.cz');
    expect(result.ok && result.displayName).toBeUndefined();
  });

  it.each([
    '',
    'jan',
    'jan@',
    '@x.cz',
    'jan@@x.cz',
    'jan@x',
    'jan@-x.cz',
    'jan@x.cz-',
    'jan@.x.cz',
    'jan@x.cz.',
    'ja n@x.cz',
    'ab',
  ])('odmítne %s jako invalid_email', (input) => {
    expect(normalizeEmail(input)).toEqual({ ok: false, code: 'invalid_email' });
  });

  it('odmítne adresu delší než 254 znaků kódem email_too_long', () => {
    expect(normalizeEmail(`${'a'.repeat(250)}@x.cz`)).toEqual({
      ok: false,
      code: 'email_too_long',
    });
  });

  it('je idempotentní: normalizace normalizované hodnoty vrátí totéž', () => {
    const once = normalizeEmail('  <JAN@Háčkyčárky.CZ>  ');
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = normalizeEmail(once.email);
    expect(twice.ok && twice.email).toBe(once.email);
  });

  it('ořeže i nedělitelnou mezeru na okrajích', () => {
    expect(normalizeEmail('\u00a0jan@x.cz\u00a0')).toEqual({ ok: true, email: 'jan@x.cz' });
  });
});

describe('maskEmail', () => {
  it('nechá první znak a doménu', () => {
    expect(maskEmail('jana@example.cz')).toBe('j***@example.cz');
  });
});

describe('seznam jednorázových domén', () => {
  it('bez načteného seznamu nic neoznačí', () => {
    loadDisposableDomains([]);
    expect(isDisposableDomain('jan@mailinator.com')).toBe(false);
  });

  it('po načtení seznamu označí doménu bez ohledu na velikost písmen a přeskočí komentáře', () => {
    loadDisposableDomains(['Mailinator.com', '# komentář', '']);
    expect(isDisposableDomain('jan@MAILINATOR.com')).toBe(true);
    expect(isDisposableDomain('jan@firma.cz')).toBe(false);
    loadDisposableDomains([]);
  });
});
