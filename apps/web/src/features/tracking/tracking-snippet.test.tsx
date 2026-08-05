import { describe, expect, it } from 'vitest';
import { buildSnippet } from './tracking-snippet';

/**
 * Úryvek je hlavní výstup celé obrazovky. Kdyby v něm byla chyba, uživatel ji
 * najde až tím, že mu na webu nic neměří, a hledat ji bude ve svém webu,
 * ne u nás.
 */
describe('buildSnippet', () => {
  const snippet = buildSnippet('https://t.example.cz', 'ml_pub_aebagbafaydqqcik');

  it('míří na /e/ml.js na měřicí doméně', () => {
    expect(snippet).toContain("s.src = 'https://t.example.cz/e/ml.js'");
  });

  it('předá veřejný klíč i host do init', () => {
    expect(snippet).toContain("key: 'ml_pub_aebagbafaydqqcik'");
    expect(snippet).toContain("host: 'https://t.example.cz'");
  });

  it('zakládá frontu Mlain.q, aby volání před načtením skriptu nespadlo', () => {
    expect(snippet).toContain('w.Mlain = w.Mlain || { q: [] }');
    expect(snippet).toContain('w.Mlain.q.push');
  });

  it('načítá skript asynchronně, aby nezdržel vykreslení cizí stránky', () => {
    expect(snippet).toContain('s.async = true');
  });

  it('obsahuje volání consent, protože bez souhlasu SDK nic neuloží', () => {
    expect(snippet).toContain('Mlain.consent(');
  });

  it('nenese žádné tajemství, jen veřejný klíč', () => {
    expect(snippet).not.toContain('ml_live_');
    expect(snippet).not.toContain('SECRET');
  });
});
