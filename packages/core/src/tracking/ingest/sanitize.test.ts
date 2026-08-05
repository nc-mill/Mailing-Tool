import { describe, expect, it } from 'vitest';
import { DEFAULT_STRIP_PARAMS, extractCampaign, sanitizeUrl } from './sanitize-url';
import { sanitizeProperties } from './sanitize-properties';

const limits = { maxKeys: 3, maxDepth: 2, maxString: 10 };

describe('sanitizeUrl', () => {
  it('odstraní přihlašovací údaje a fragment', () => {
    expect(sanitizeUrl('https://user:pass@x.cz/a#kotva', DEFAULT_STRIP_PARAMS)).toBe(
      'https://x.cz/a',
    );
  });

  it('odstraní citlivé parametry včetně ml_token', () => {
    const out = sanitizeUrl(
      'https://x.cz/a?token=abc&ml_token=t1&email=a@b.cz&keep=1',
      DEFAULT_STRIP_PARAMS,
    );
    expect(out).toBe('https://x.cz/a?keep=1');
  });

  it('zachová utm a značkovací parametry', () => {
    const out = sanitizeUrl(
      'https://x.cz/a?utm_source=news&gclid=g1&fbclid=f1',
      DEFAULT_STRIP_PARAMS,
    );
    expect(out).toContain('utm_source=news');
    expect(out).toContain('gclid=g1');
    expect(out).toContain('fbclid=f1');
  });

  it('u citlivé cesty zahodí celý query řetězec', () => {
    for (const path of ['/reset-hesla', '/obnova-hesla', '/login', '/prihlaseni', '/verify']) {
      expect(sanitizeUrl(`https://x.cz${path}?cokoliv=1`, DEFAULT_STRIP_PARAMS)).toBe(
        `https://x.cz${path}`,
      );
    }
  });

  it('nevalidní adresu vrátí jako prázdný řetězec, ne jako výjimku', () => {
    expect(sanitizeUrl('není url', DEFAULT_STRIP_PARAMS)).toBe('');
  });

  it('rozparsuje utm parametry do context.campaign', () => {
    expect(extractCampaign('https://x.cz/a?utm_source=news&utm_medium=email')).toEqual({
      source: 'news',
      medium: 'email',
    });
  });

  it('adresa bez utm nevrátí prázdný objekt, ale undefined', () => {
    expect(extractCampaign('https://x.cz/a')).toBeUndefined();
  });
});

describe('sanitizeProperties', () => {
  it('ořeže počet klíčů abecedně od konce a ohlásí nález', () => {
    const out = sanitizeProperties({ a: 1, b: 2, c: 3, d: 4, e: 5 }, limits);
    expect(Object.keys(out.value).sort()).toEqual(['a', 'b', 'c']);
    expect(out.findings[0]).toMatchObject({
      code: 'tracking_properties_keys_dropped',
      severity: 'warning',
    });
    expect(out.findings[0]!.params).toMatchObject({ dropped: 2, limit: 3 });
  });

  it('ořeže dlouhý řetězec a ohlásí původní délku', () => {
    const out = sanitizeProperties({ description: 'x'.repeat(40) }, limits);
    expect((out.value['description'] as string).length).toBe(10);
    expect(out.findings[0]).toMatchObject({ code: 'tracking_properties_value_truncated' });
    expect(out.findings[0]!.params).toMatchObject({
      key: 'description',
      limit: 10,
      original_length: 40,
    });
  });

  it('nahradí hlubší úrovně hodnotou null a ohlásí cestu', () => {
    const out = sanitizeProperties({ cart: { items: { deep: 1 } } }, limits);
    expect(out.value).toEqual({ cart: { items: null } });
    expect(out.findings[0]).toMatchObject({ code: 'tracking_properties_depth_truncated' });
  });

  it('zahodí klíč delší než 64 znaků', () => {
    const out = sanitizeProperties({ [`${'k'.repeat(65)}`]: 1, ok: 2 }, limits);
    expect(Object.keys(out.value)).toEqual(['ok']);
    expect(out.findings.some((f) => f.code === 'tracking_properties_keys_dropped')).toBe(true);
  });

  it('vzorek zahozených klíčů je nejvýš pět jmen', () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`k${String(i).padStart(2, '0')}`, i]),
    );
    const out = sanitizeProperties(many, limits);
    expect((out.findings[0]!.params!['keys'] as string[]).length).toBeLessThanOrEqual(5);
  });

  it('vlastnosti v limitu projdou beze změny a bez nálezu', () => {
    const out = sanitizeProperties({ value: 1490.5, currency: 'CZK' }, limits);
    expect(out.value).toEqual({ value: 1490.5, currency: 'CZK' });
    expect(out.findings).toHaveLength(0);
  });
});
