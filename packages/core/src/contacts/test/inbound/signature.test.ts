import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderTemplate, verifySignature } from '../../inbound/signature';

const secret = 'tajemstvi';
const body = Buffer.from('{"id":"1"}', 'utf8');

describe('šablona pro HMAC', () => {
  it('nahradí body syrovým tělem', () => {
    expect(renderTemplate('{body}', { body, timestamp: '123', slug: 's' })).toBe('{"id":"1"}');
  });

  it('nahradí kombinaci placeholderů', () => {
    expect(renderTemplate('{timestamp}.{body}', { body, timestamp: '123', slug: 's' })).toBe(
      '123.{"id":"1"}',
    );
  });

  it('nepodporuje nic jiného než tři placeholdery', () => {
    expect(renderTemplate('{neznamy}', { body, timestamp: '123', slug: 's' })).toBe('{neznamy}');
  });
});

describe('hmac_sha256', () => {
  const config = {
    header: 'x-signature',
    encoding: 'hex' as const,
    template: '{timestamp}.{body}',
    timestampHeader: 'x-timestamp',
    toleranceSeconds: 300,
  };
  const now = Math.floor(Date.now() / 1000);
  const sign = (timestamp: string) =>
    createHmac('sha256', secret)
      .update(`${timestamp}.${body.toString('utf8')}`)
      .digest('hex');

  it('platný podpis projde', () => {
    const timestamp = String(now);
    expect(
      verifySignature({
        mode: 'hmac_sha256',
        config,
        secret,
        body,
        slug: 's',
        headers: { 'x-signature': sign(timestamp), 'x-timestamp': timestamp },
      }),
    ).toEqual({ ok: true });
  });

  it('KRITÉRIUM 90: pozměněné tělo neprojde', () => {
    const timestamp = String(now);
    expect(
      verifySignature({
        mode: 'hmac_sha256',
        config,
        secret,
        body: Buffer.from('{"id":"2"}'),
        slug: 's',
        headers: { 'x-signature': sign(timestamp), 'x-timestamp': timestamp },
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('chybějící hlavička s podpisem neprojde', () => {
    expect(
      verifySignature({ mode: 'hmac_sha256', config, secret, body, slug: 's', headers: {} }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('staré časové razítko neprojde, ochrana proti přehrání', () => {
    const old = String(now - 400);
    expect(
      verifySignature({
        mode: 'hmac_sha256',
        config,
        secret,
        body,
        slug: 's',
        headers: { 'x-signature': sign(old), 'x-timestamp': old },
      }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('podporuje kódování base64', () => {
    const timestamp = String(now);
    const mac = createHmac('sha256', secret)
      .update(`${timestamp}.${body.toString('utf8')}`)
      .digest('base64');
    expect(
      verifySignature({
        mode: 'hmac_sha256',
        config: { ...config, encoding: 'base64' },
        secret,
        body,
        slug: 's',
        headers: { 'x-signature': mac, 'x-timestamp': timestamp },
      }),
    ).toEqual({ ok: true });
  });

  it('chybějící tajemství neprojde ani při správném režimu', () => {
    expect(
      verifySignature({
        mode: 'hmac_sha256',
        config,
        secret: null,
        body,
        slug: 's',
        headers: { 'x-signature': 'x' },
      }),
    ).toEqual({ ok: false, reason: 'missing_secret' });
  });

  it('podpis o jiné délce neshodí porovnání v konstantním čase', () => {
    const timestamp = String(now);
    // timingSafeEqual hodí výjimku na různě dlouhé buffery. Kdyby se délka neošetřila,
    // stačilo by poslat kratší podpis a endpoint by spadl na neošetřené výjimce.
    expect(() =>
      verifySignature({
        mode: 'hmac_sha256',
        config,
        secret,
        body,
        slug: 's',
        headers: { 'x-signature': 'ab', 'x-timestamp': timestamp },
      }),
    ).not.toThrow();
  });
});

describe('ostatní režimy', () => {
  it('shared_secret porovná hodnotu hlavičky', () => {
    expect(
      verifySignature({
        mode: 'shared_secret',
        config: { header: 'x-key' },
        secret,
        body,
        slug: 's',
        headers: { 'x-key': secret },
      }),
    ).toEqual({ ok: true });
    expect(
      verifySignature({
        mode: 'shared_secret',
        config: { header: 'x-key' },
        secret,
        body,
        slug: 's',
        headers: { 'x-key': 'spatne' },
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('basic ověří jméno a heslo', () => {
    const auth = `Basic ${Buffer.from(`eshop:${secret}`).toString('base64')}`;
    expect(
      verifySignature({
        mode: 'basic',
        config: { username: 'eshop' },
        secret,
        body,
        slug: 's',
        headers: { authorization: auth },
      }),
    ).toEqual({ ok: true });
  });

  it('basic s cizím heslem neprojde', () => {
    const auth = `Basic ${Buffer.from('eshop:jine-heslo').toString('base64')}`;
    expect(
      verifySignature({
        mode: 'basic',
        config: { username: 'eshop' },
        secret,
        body,
        slug: 's',
        headers: { authorization: auth },
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('režim none projde vždy, ale rozhraní u něj zobrazuje varování', () => {
    expect(
      verifySignature({ mode: 'none', config: {}, secret: null, body, slug: 's', headers: {} }),
    ).toEqual({ ok: true });
  });
});

describe('porovnání v konstantním čase', () => {
  it('zdrojový kód nikde nepoužívá porovnání řetězců operátorem', () => {
    // Ptá se zdrojáku schválně: rozdíl mezi `a === b` a timingSafeEqual není v chování,
    // takže ho žádný funkční test nechytí. Zachytí ho jen tenhle pohled na text.
    const source = readSignatureSource();
    expect(source).toContain('timingSafeEqual');
    expect(source).not.toMatch(/provided\s*===\s*expected/);
    expect(source).not.toMatch(/decoded\s*===\s*expected/);
  });
});

function readSignatureSource(): string {
  return readFileSync(new URL('../../inbound/signature.ts', import.meta.url), 'utf8');
}
