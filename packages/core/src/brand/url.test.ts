import { describe, expect, it } from 'vitest';
import { BLOCKED_HOST_SUFFIXES, normalizeBrandUrl } from './url';

const policy = {
  allowHttp: true,
  blockedHosts: ['metadata.google.internal', 'metadata.goog', 'instance-data', 'metadata'],
  allowedHosts: [] as string[],
};

const ok = (input: string) => {
  const result = normalizeBrandUrl(input, policy);
  if (!result.ok) throw new Error(`očekáván úspěch, přišlo ${result.code}`);
  return result.url;
};
const fail = (input: string, overrides: Partial<typeof policy> = {}) => {
  const result = normalizeBrandUrl(input, { ...policy, ...overrides });
  if (result.ok) throw new Error('očekáváno odmítnutí');
  return result.code;
};

describe('normalizace URL', () => {
  it('zahodí fragment a zachová query', () => {
    expect(ok('https://kolo-shop.cz/uvod?a=1#kotva')).toBe('https://kolo-shop.cz/uvod?a=1');
  });

  it('normalizuje IDN na punycode', () => {
    // Očekávaná hodnota je ověřená proti WHATWG parseru, ne opsaná:
    // `url.domainToASCII('čeština.cz')` vrací xn--etina-gya30d.cz a
    // `url.domainToUnicode` ji vrátí zpátky na čeština.cz.
    expect(ok('https://čeština.cz/')).toBe('https://xn--etina-gya30d.cz/');
  });

  it('odebere tečku na konci hostu, aby nešlo obejít suffixovou kontrolu', () => {
    expect(ok('https://example.com./')).toBe('https://example.com/');
  });
});

describe('syntaktické kontroly', () => {
  it('nenaparsovatelná URL je brand_invalid_url', () => {
    expect(fail('tohle není adresa')).toBe('brand_invalid_url');
  });

  it('jiné schéma než http a https je brand_scheme_not_allowed', () => {
    expect(fail('ftp://kolo-shop.cz/')).toBe('brand_scheme_not_allowed');
    expect(fail('file:///etc/passwd')).toBe('brand_scheme_not_allowed');
    expect(fail('gopher://kolo-shop.cz/')).toBe('brand_scheme_not_allowed');
  });

  it('http je odmítnuté, když BRAND_FETCH_ALLOW_HTTP je false', () => {
    expect(fail('http://kolo-shop.cz/', { allowHttp: false })).toBe('brand_scheme_not_allowed');
    expect(ok('http://kolo-shop.cz/')).toBe('http://kolo-shop.cz/');
  });

  it('přihlašovací údaje v adrese jsou brand_credentials_in_url', () => {
    expect(fail('https://user:heslo@kolo-shop.cz/')).toBe('brand_credentials_in_url');
    expect(fail('https://user@kolo-shop.cz/')).toBe('brand_credentials_in_url');
  });

  it('nestandardní port je brand_port_not_allowed, 80 a 443 projdou', () => {
    expect(fail('https://kolo-shop.cz:8080/')).toBe('brand_port_not_allowed');
    expect(ok('http://kolo-shop.cz:80/')).toBe('http://kolo-shop.cz/');
    expect(ok('https://kolo-shop.cz:443/')).toBe('https://kolo-shop.cz/');
  });

  it('URL nad 2048 znaků je brand_invalid_url', () => {
    expect(fail(`https://kolo-shop.cz/${'a'.repeat(2100)}`)).toBe('brand_invalid_url');
  });

  it('T3: metadata.google.internal se odmítne podle jména, bez DNS', () => {
    expect(fail('http://metadata.google.internal/')).toBe('brand_host_not_allowed');
    expect(fail('http://metadata/')).toBe('brand_host_not_allowed');
    expect(fail('http://instance-data/')).toBe('brand_host_not_allowed');
  });

  it('T1: localhost se odmítne podle jména', () => {
    expect(fail('http://localhost/')).toBe('brand_host_not_allowed');
  });

  it('zakázané přípony hostu se odmítnou', () => {
    for (const suffix of BLOCKED_HOST_SUFFIXES) {
      expect(fail(`http://firma${suffix}/`)).toBe('brand_host_not_allowed');
    }
  });

  it('allowlist, když je vyplněný, pustí jen uvedenou doménu a její subdomény', () => {
    const allowedHosts = ['kolo-shop.cz'];
    expect(normalizeBrandUrl('https://kolo-shop.cz/', { ...policy, allowedHosts }).ok).toBe(true);
    expect(normalizeBrandUrl('https://www.kolo-shop.cz/', { ...policy, allowedHosts }).ok).toBe(
      true,
    );
    expect(fail('https://jiny.cz/', { allowedHosts })).toBe('brand_host_not_allowed');
    expect(fail('https://kolo-shop.cz.zlo.example/', { allowedHosts })).toBe(
      'brand_host_not_allowed',
    );
  });

  it('T4: podivné zápisy loopbacku parser normalizuje, takže je pozná kontrola IP', () => {
    // Tady jen ověřujeme, že se dostanou do kanonického tvaru; odmítá je úkol 21.
    expect(ok('http://2130706433/')).toBe('http://127.0.0.1/');
    expect(ok('http://0x7f000001/')).toBe('http://127.0.0.1/');
    expect(ok('http://017700000001/')).toBe('http://127.0.0.1/');
    expect(ok('http://127.1/')).toBe('http://127.0.0.1/');
  });
});
