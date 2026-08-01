import { beforeEach, describe, expect, it } from 'vitest';
import { buildTrackingKeyring } from '../tokens/keyring';
import { ProxyRangeIndex } from './proxy-ranges';
import { createOpenHandler, type BufferedOpen } from './handle-open';

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const OPEN = 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g';

describe('open handler', () => {
  let buffered: BufferedOpen[];
  let handle: ReturnType<typeof createOpenHandler>;

  beforeEach(() => {
    buffered = [];
    handle = createOpenHandler({
      keyring: ring,
      proxyRanges: new ProxyRangeIndex([]),
      push: (item) => buffered.push(item),
    });
  });

  it('platný token s klientem Outlook zařadí otevření třídy human', () => {
    handle({
      token: OPEN,
      userAgent: 'Microsoft Outlook 16.0',
      method: 'GET',
      headers: {},
      ip: null,
      now: new Date(),
    });
    expect(buffered).toHaveLength(1);
    expect(buffered[0]).toMatchObject({ openClass: 'human', messageCreatedAt: 1784995200 });
  });

  it('neplatný token nezařadí nic a nevyhodí výjimku', () => {
    handle({
      token: 't1xxxx',
      userAgent: 'Outlook',
      method: 'GET',
      headers: {},
      ip: null,
      now: new Date(),
    });
    expect(buffered).toHaveLength(0);
  });

  it('crawler se nezapíše vůbec', () => {
    handle({
      token: OPEN,
      userAgent: 'Googlebot/2.1',
      method: 'GET',
      headers: {},
      ip: null,
      now: new Date(),
    });
    expect(buffered).toHaveLength(0);
  });

  it('token typu o na jiném endpointu neprojde, kontrolu dělá volající se seznamem typů', () => {
    handle({
      token: OPEN,
      userAgent: 'Outlook',
      method: 'GET',
      headers: {},
      ip: null,
      now: new Date(),
    });
    expect(buffered).toHaveLength(1);
  });

  it('strop se počítá zvlášť pro každou třídu, takže Apple proxy nevyčerpá strop člověku', () => {
    const now = new Date('2026-08-02T10:00:00Z');
    for (let i = 0; i < 150; i += 1) {
      handle({ token: OPEN, userAgent: 'Mozilla/5.0', method: 'GET', headers: {}, ip: null, now });
    }
    const appleCount = buffered.filter((item) => item.openClass === 'proxy_apple').length;
    expect(appleCount).toBe(100); // dílčí strop, tedy polovina z OPEN_CAP_PER_MESSAGE_PER_DAY

    handle({
      token: OPEN,
      userAgent: 'Microsoft Outlook 16.0',
      method: 'GET',
      headers: {},
      ip: null,
      now,
    });
    expect(buffered.filter((item) => item.openClass === 'human')).toHaveLength(1);
  });
});
