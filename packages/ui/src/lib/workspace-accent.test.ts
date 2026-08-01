import { describe, expect, it } from 'vitest';
import { workspaceAccent, workspaceAccentHue } from './workspace-accent';

const id = '018f2b1c-0000-7000-8000-000000000001';

describe('workspaceAccent', () => {
  it('je deterministická, stejné id dá vždy stejnou barvu', () => {
    expect(workspaceAccent(id)).toBe(workspaceAccent(id));
  });

  it('různá id dávají různé odstíny', () => {
    const first = workspaceAccent('018f2b1c-0000-7000-8000-000000000001');
    const second = workspaceAccent('018f2b1c-0000-7000-8000-000000000002');
    expect(first).not.toBe(second);
  });

  it('vrací oklch se stabilní sytostí, takže kontrast nezáleží na náhodě', () => {
    expect(workspaceAccent(id)).toMatch(
      /^oklch\(var\(--workspace-accent-l\) 0\.16 \d+(\.\d+)?\)$/,
    );
  });

  // Tohle je jádro věci, ne detail. Dokud si světlost vybíral JavaScript podle
  // předaného motivu, vykreslil server jinou barvu než klient, protože motiv
  // prohlížeče nezná. React to hlásil jako nesoulad hydratace s poznámkou
  // „This won't be patched up", tedy rozdíl, který sám neopraví.
  //
  // Test proto ověřuje, že výsledek na motivu vůbec NEZÁVISÍ: funkce ho nebere
  // a světlost zůstává jako CSS proměnná, kterou dopočítá až motiv v tokens.css.
  it('výsledek nezávisí na motivu, takže server a klient vykreslí totéž', () => {
    expect(workspaceAccent.length).toBe(1);
    expect(workspaceAccent(id)).toContain('var(--workspace-accent-l)');
    expect(workspaceAccent(id)).not.toMatch(/oklch\(0\.\d+ /);
  });

  it('odstín je celé číslo ve stupních a je deterministický', () => {
    const hue = workspaceAccentHue(id);
    expect(Number.isInteger(hue)).toBe(true);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
    expect(workspaceAccentHue(id)).toBe(hue);
  });

  it('prázdné id nespadne, vrátí neutrální odstín', () => {
    expect(workspaceAccent('')).toMatch(/^oklch\(/);
  });
});
