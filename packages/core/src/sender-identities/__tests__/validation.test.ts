import { describe, expect, it } from 'vitest';
import { checkSenderIdentity, emailBelongsToDomain, emailDomain } from '../validation';

describe('doménová část adresy', () => {
  it('vrátí doménu malými písmeny', () => {
    expect(emailDomain('Newsletter@Kolo-Shop.CZ')).toBe('kolo-shop.cz');
  });

  it('odmítne, co adresa není', () => {
    for (const value of ['', 'bez-zavinace', '@kolo-shop.cz', 'a@', 'a@.cz', 'a@cz.']) {
      expect(emailDomain(value), value).toBeNull();
    }
  });
});

describe('adresa patří do odesílací domény', () => {
  it('doslovná shoda projde bez ohledu na velikost písmen', () => {
    expect(emailBelongsToDomain('Newsletter@KOLO-SHOP.cz', 'kolo-shop.cz')).toBe(true);
  });

  it('poddoména ověřené domény projde, protože z ní Amazon odesílat umí', () => {
    expect(emailBelongsToDomain('a@news.kolo-shop.cz', 'kolo-shop.cz')).toBe(true);
    expect(emailBelongsToDomain('a@a.b.kolo-shop.cz', 'kolo-shop.cz')).toBe(true);
  });

  it('doména, která na tu naši jen KONČÍ, neprojde', () => {
    // `mojekolo-shop.cz` končí na `kolo-shop.cz` a je to úplně cizí doména.
    // Naivní endsWith by ji pustil a odesílalo by se z domény, kterou nikdo
    // neověřoval.
    expect(emailBelongsToDomain('a@mojekolo-shop.cz', 'kolo-shop.cz')).toBe(false);
  });

  it('nadřazená doména neprojde', () => {
    // Ověřená je `news.kolo-shop.cz`, adresa je na `kolo-shop.cz`. Ověření
    // poddomény o nadřazené doméně neříká nic.
    expect(emailBelongsToDomain('a@kolo-shop.cz', 'news.kolo-shop.cz')).toBe(false);
  });

  it('cizí doména neprojde', () => {
    expect(emailBelongsToDomain('a@jinde.cz', 'kolo-shop.cz')).toBe(false);
  });
});

describe('kontrola předvolby', () => {
  it('v pořádku vrací null', () => {
    expect(checkSenderIdentity({ fromEmail: 'a@kolo-shop.cz', domain: 'kolo-shop.cz' })).toBeNull();
  });

  it('u nesouladu ukáže na pole a řekne, jakou doménu v adrese vidí', () => {
    expect(checkSenderIdentity({ fromEmail: 'a@jinde.cz', domain: 'kolo-shop.cz' })).toEqual({
      path: 'from_email',
      code: 'email_outside_domain',
      emailDomain: 'jinde.cz',
    });
  });

  it('adresa bez zavináče nespadne, jen neprojde', () => {
    expect(checkSenderIdentity({ fromEmail: 'nesmysl', domain: 'kolo-shop.cz' })).toEqual({
      path: 'from_email',
      code: 'email_outside_domain',
      emailDomain: '',
    });
  });
});
