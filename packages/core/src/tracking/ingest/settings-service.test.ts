import { describe, expect, it } from 'vitest';
import { originMatches } from '../domains/domain-cache';

/**
 * Shoda `Origin` proti povoleným doménám. Je to bezpečnostní kontrola, ne
 * kosmetika: kdo ji obejde, dostane cizí identitu na svůj web.
 */
describe('originMatches', () => {
  const allowed = [
    { host: 'shop.cz', includeSubdomains: false },
    { host: 'example.cz', includeSubdomains: true },
  ];

  it('přesná shoda projde', () => {
    expect(originMatches(allowed, 'shop.cz')).toBe(true);
  });

  it('subdoména bez povolení neprojde', () => {
    expect(originMatches(allowed, 'blog.shop.cz')).toBe(false);
  });

  it('subdoména s povolením projde', () => {
    expect(originMatches(allowed, 'blog.example.cz')).toBe(true);
  });

  it('shoda musí být na hranici tečky, ne prosté endsWith', () => {
    // Bez téhle podmínky by `zlyexample.cz` prošlo na pravidlo pro `example.cz`
    // a byl by to únik identity na cizí web.
    expect(originMatches(allowed, 'zlyexample.cz')).toBe(false);
  });

  it('celá adresa se normalizuje, takže projde i s protokolem a portem', () => {
    expect(originMatches(allowed, 'https://shop.cz:8443')).toBe(true);
  });

  it('prázdný seznam nepustí nikoho', () => {
    expect(originMatches([], 'shop.cz')).toBe(false);
  });

  it('localhost se chová jako každá jiná doména', () => {
    expect(originMatches([{ host: 'localhost', includeSubdomains: false }], 'localhost')).toBe(
      true,
    );
  });
});
