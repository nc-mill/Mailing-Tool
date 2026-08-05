import { describe, expect, it } from 'vitest';
import { sanitizePublicRef, sanitizePublicSlug, sanitizePublicToken } from './public-link';

/**
 * Nahlášená vada: klik na odhlášení v Gmailu skončil hláškou „Tenhle odkaz neplatí".
 * Gmail připojuje sledovací parametry NAIVNÍM spojením, tedy `&source=gmail&…` i za
 * adresu, která žádné `?` nemá, a přílepek se tím stane součástí segmentu cesty.
 */
describe('sanitizePublicToken', () => {
  const TOKEN = 't1dQEBn8djcYRy3aSNPP-_xyz';

  it('uřízne přílepek, který za odkaz přilepil Gmail', () => {
    expect(sanitizePublicToken(`${TOKEN}&source=gmail&ust=1785931489061000&usg=AOvVaw2`)).toBe(
      TOKEN,
    );
  });

  it('uřízne i řádně oddělený query řetězec a fragment', () => {
    expect(sanitizePublicToken(`${TOKEN}?utm_source=x`)).toBe(TOKEN);
    expect(sanitizePublicToken(`${TOKEN}#hash`)).toBe(TOKEN);
  });

  it('čistý token nechá beze změny, včetně pomlčky a podtržítka', () => {
    expect(sanitizePublicToken(TOKEN)).toBe(TOKEN);
  });

  it('řeže na PRVNÍM cizím znaku, zbytky neslepuje', () => {
    // Slepování by z neplatného tokenu mohlo omylem složit platný.
    expect(sanitizePublicToken('t1AAA&x=1BBB')).toBe('t1AAA');
  });

  it('cizí znak hned na začátku dá prázdný řetězec, ne výjimku', () => {
    expect(sanitizePublicToken('&source=gmail')).toBe('');
  });

  it('nezachraňuje token, který je poškozený sám o sobě', () => {
    // Standardní base64 místo base64url zůstane useknuté a ověření ho odmítne,
    // stejně jako předtím. Očista není shovívavost k podpisu.
    expect(sanitizePublicToken('t1AAA+BBB')).toBe('t1AAA');
  });
});

describe('sanitizePublicRef a sanitizePublicSlug', () => {
  it('potvrzovací odkaz přežije přílepek', () => {
    const ref = `${'a'.repeat(32)}Xy_-09`;
    expect(sanitizePublicRef(`${ref}&source=gmail`)).toBe(ref);
  });

  it('slug formuláře se čistí malou abecedou a tečka do něj nepatří', () => {
    expect(sanitizePublicSlug('ABCdef-123')).toBe('abcdef-123');
    expect(sanitizePublicSlug('form.js')).toBe('form');
  });
});
