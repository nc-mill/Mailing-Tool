import { describe, expect, it } from 'vitest';
import {
  decodeSenderIdentityFingerprints,
  encodeSenderIdentityFingerprints,
  matchSenderIdentity,
  senderFingerprint,
} from './sender-fingerprint';

const NEWSLETTER = {
  id: 'sid-1',
  from_name: 'Kolo Shop',
  from_email: 'newsletter@kolo-shop.cz',
  reply_to: 'odpovedi@kolo-shop.cz',
  provider_id: 'prov-1',
  sender_domain_id: 'dom-1',
};

describe('otisk údajů o odesílateli', () => {
  it('bere jiný zápis téže hodnoty jako tutéž sadu', () => {
    expect(senderFingerprint({ ...NEWSLETTER, from_email: 'Newsletter@Kolo-Shop.CZ' })).toBe(
      senderFingerprint(NEWSLETTER),
    );
    expect(senderFingerprint({ ...NEWSLETTER, from_name: '  Kolo Shop  ' })).toBe(
      senderFingerprint(NEWSLETTER),
    );
  });

  it('nevyplněnou adresu pro odpovědi počítá stejně, ať přijde prázdná nebo null', () => {
    expect(senderFingerprint({ ...NEWSLETTER, reply_to: null })).toBe(
      senderFingerprint({ ...NEWSLETTER, reply_to: '' }),
    );
  });

  it('změnu kterékoli z pěti hodnot pozná', () => {
    const base = senderFingerprint(NEWSLETTER);
    expect(senderFingerprint({ ...NEWSLETTER, from_name: 'Kolo Shop s.r.o.' })).not.toBe(base);
    expect(senderFingerprint({ ...NEWSLETTER, from_email: 'jiny@kolo-shop.cz' })).not.toBe(base);
    expect(senderFingerprint({ ...NEWSLETTER, reply_to: null })).not.toBe(base);
    expect(senderFingerprint({ ...NEWSLETTER, provider_id: 'prov-2' })).not.toBe(base);
    expect(senderFingerprint({ ...NEWSLETTER, sender_domain_id: 'dom-2' })).not.toBe(base);
  });

  /**
   * Hodnoty se skládají do jednoho řetězce, takže se text s uvozovkou nebo
   * svislítkem nesmí přelít do sousedního pole a vyrobit falešnou shodu.
   */
  it('hodnotu s uvozovkami nepřelije do sousedního pole', () => {
    expect(senderFingerprint({ ...NEWSLETTER, from_name: 'Kolo","Shop' })).not.toBe(
      senderFingerprint({ ...NEWSLETTER, from_name: 'Kolo', from_email: 'Shop' }),
    );
  });
});

describe('hledání předvolby podle otisku', () => {
  const identities = encodeSenderIdentityFingerprints([NEWSLETTER]);

  it('projde tam a zpátky skrz skryté pole formuláře', () => {
    expect(decodeSenderIdentityFingerprints(identities)).toEqual([
      { id: 'sid-1', fingerprint: senderFingerprint(NEWSLETTER) },
    ]);
  });

  it('na hodnoty, které nesedí na žádnou předvolbu, vrací null', () => {
    const found = matchSenderIdentity(
      decodeSenderIdentityFingerprints(identities),
      senderFingerprint({ ...NEWSLETTER, from_email: 'jiny@kolo-shop.cz' }),
      'sid-1',
    );
    expect(found).toBeNull();
  });

  /**
   * Dvě předvolby se můžou lišit jen jménem („Newsletter" a „Novinky" nad touž
   * adresou). Bez přednosti pro tu vybranou by uložení nastavení přeskakovalo
   * mezi nimi podle pořadí v seznamu a uživatel by viděl, jak se mu výběr sám
   * mění.
   */
  it('při shodě víc předvoleb nechá tu, kterou má kampaň vybranou', () => {
    const dvojice = encodeSenderIdentityFingerprints([NEWSLETTER, { ...NEWSLETTER, id: 'sid-2' }]);
    const list = decodeSenderIdentityFingerprints(dvojice);
    expect(matchSenderIdentity(list, senderFingerprint(NEWSLETTER), 'sid-2')).toBe('sid-2');
    expect(matchSenderIdentity(list, senderFingerprint(NEWSLETTER), '')).toBe('sid-1');
  });

  /**
   * Obsah skrytého pole přichází z prohlížeče, takže nesmyslná hodnota nesmí
   * shodit uložení celého nastavení. Prázdný výsledek znamená „o předvolbách
   * nevím nic" a volající na něj reaguje tím, že odkaz nechá být.
   */
  it('nesmyslný obsah skrytého pole spolkne, místo aby na něm spadl', () => {
    expect(decodeSenderIdentityFingerprints('')).toEqual([]);
    expect(decodeSenderIdentityFingerprints('{tohle není JSON')).toEqual([]);
    expect(decodeSenderIdentityFingerprints('{"a":1}')).toEqual([]);
    expect(decodeSenderIdentityFingerprints('[["",""],[1,2],["sid-3","x"]]')).toEqual([
      { id: 'sid-3', fingerprint: 'x' },
    ]);
  });
});
