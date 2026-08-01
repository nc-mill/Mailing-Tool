import { describe, expect, it } from 'vitest';
import { collectUserUrls, isUrlFromUser } from './context';

describe('množina URL od uživatele', () => {
  it('vytáhne adresy z uživatelských zpráv, ne z odpovědí modelu', () => {
    const urls = collectUserUrls([
      { role: 'user', text: 'Stáhni barvy z https://kolo-shop.cz prosím' },
      { role: 'assistant', text: 'Zkusím i https://zlo.example' },
    ]);
    expect([...urls]).toEqual(['https://kolo-shop.cz/']);
  });

  it('normalizuje tvar, aby http://Kolo-Shop.CZ a https://kolo-shop.cz nebyly dvě věci', () => {
    const urls = collectUserUrls([{ role: 'user', text: 'https://Kolo-Shop.CZ/uvod?a=1#kotva' }]);
    expect([...urls]).toEqual(['https://kolo-shop.cz/uvod?a=1']);
  });

  it('adresu mimo množinu neuzná', () => {
    const urls = collectUserUrls([{ role: 'user', text: 'https://kolo-shop.cz' }]);
    expect(isUrlFromUser('https://kolo-shop.cz/', urls)).toBe(true);
    expect(isUrlFromUser('http://169.254.169.254/latest/meta-data/', urls)).toBe(false);
  });

  it('uzná i jinou cestu na témže hostu, protože host zadal uživatel', () => {
    const urls = collectUserUrls([{ role: 'user', text: 'https://kolo-shop.cz' }]);
    expect(isUrlFromUser('https://kolo-shop.cz/kontakt', urls)).toBe(true);
  });

  it('neuzná jiný host, ani když je podřetězcem zadaného', () => {
    const urls = collectUserUrls([{ role: 'user', text: 'https://kolo-shop.cz' }]);
    expect(isUrlFromUser('https://kolo-shop.cz.zlo.example/', urls)).toBe(false);
    expect(isUrlFromUser('https://evil-kolo-shop.cz/', urls)).toBe(false);
  });

  it('nesmyslný vstup nespadne, jen se neuzná', () => {
    expect(isUrlFromUser('nic', new Set())).toBe(false);
  });
});
