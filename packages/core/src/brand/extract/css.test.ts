import { describe, expect, it } from 'vitest';
import { collectColorCandidates, collectTypographyCandidates } from './css';

describe('sběr barevných kandidátů z CSS', () => {
  it('custom properties s brandovým názvem mají vysokou váhu', () => {
    const candidates = collectColorCandidates(':root{--brand-primary:#c41e3a;--x:#123456}');
    const brand = candidates.find((c) => c.hex === '#c41e3a');
    expect(brand?.weight).toBe('high');
    expect(brand?.source).toBe('css-var');
  });

  it('rozpozná názvy primary, accent, main a theme', () => {
    for (const name of ['--primary', '--accent-color', '--main-color', '--theme-color']) {
      const candidates = collectColorCandidates(`:root{${name}:#abcdef}`);
      expect(candidates[0]?.weight).toBe('high');
    }
  });

  it('barvy na tlačítkových selektorech mají střední váhu', () => {
    const candidates = collectColorCandidates('.btn-primary{background:#c41e3a}');
    expect(candidates[0]).toMatchObject({
      hex: '#c41e3a',
      weight: 'medium',
      source: 'css-selector',
    });
  });

  it('ostatní barvy mají nízkou váhu a počítají se výskyty', () => {
    const candidates = collectColorCandidates(
      '.a{color:#112233}.b{color:#112233}.c{color:#445566}',
    );
    const repeated = candidates.find((c) => c.hex === '#112233');
    expect(repeated?.weight).toBe('low');
    expect(repeated?.occurrences).toBe(2);
  });

  it('rozpozná rgb i zkrácený hex a převede na šestimístný tvar', () => {
    const candidates = collectColorCandidates('.a{color:rgb(196,30,58)}.b{color:#abc}');
    expect(candidates.map((c) => c.hex)).toContain('#c41e3a');
    expect(candidates.map((c) => c.hex)).toContain('#aabbcc');
  });

  it('nesrozumitelné CSS nespadne, jen nic nevrátí', () => {
    expect(collectColorCandidates('{{{ tohle není css')).toEqual([]);
  });

  it('theme-color z meta má nejvyšší váhu a vlastní zdroj', () => {
    const candidates = collectColorCandidates('', { themeColor: '#c41e3a' });
    expect(candidates[0]).toMatchObject({ hex: '#c41e3a', weight: 'high', source: 'meta' });
  });
});

describe('sběr kandidátů na písmo a zaoblení', () => {
  it('posbírá deklarované rodiny písma a poloměry', () => {
    const result = collectTypographyCandidates(
      'body{font-family:Inter, sans-serif}.btn{border-radius:6px}h1{font-family:Georgia, serif}',
    );
    expect(result.fontFamilies).toEqual(['Inter, sans-serif', 'Georgia, serif']);
    expect(result.radii).toEqual(['6px']);
  });

  it('nesrozumitelné CSS vrátí prázdné seznamy', () => {
    expect(collectTypographyCandidates('{{{')).toEqual({ fontFamilies: [], radii: [] });
  });
});
