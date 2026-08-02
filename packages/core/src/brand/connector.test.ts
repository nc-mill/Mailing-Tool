import { describe, expect, it, vi } from 'vitest';
import type { buildConnector } from 'undici';
import { createPinnedConnector } from './connector';

const fakeSocket = (remoteAddress: string) => ({
  remoteAddress,
  destroy: vi.fn(),
});

type Inner = (opts: Record<string, unknown>, cb: (e: unknown, s: unknown) => void) => void;

/** Tovární funkce ve tvaru, který `createPinnedConnector` očekává od undici. */
const factory = (inner: Inner) => (() => inner) as unknown as typeof buildConnector;

describe('konektor s připnutou IP', () => {
  it('spojení navazuje na ověřenou IP, ne na jméno', async () => {
    const inner = vi.fn<Inner>((_opts, cb) => {
      cb(null, fakeSocket('93.184.216.34'));
    });
    const connect = createPinnedConnector({
      pinnedIp: '93.184.216.34',
      servername: 'kolo-shop.cz',
      buildConnector: factory(inner),
    });
    await new Promise<void>((resolve) => {
      connect({ hostname: 'kolo-shop.cz', protocol: 'https:', port: 443 }, () => resolve());
    });
    const opts = inner.mock.calls[0]?.[0];
    expect(opts?.hostname).toBe('93.184.216.34');
    expect(opts?.servername).toBe('kolo-shop.cz');
    expect(opts?.rejectUnauthorized).toBe(true);
    expect(opts?.autoSelectFamily).toBe(false);
  });

  it('T8: když se socket připojí na privátní adresu, spojení se zruší', async () => {
    const socket = fakeSocket('10.0.0.5');
    const inner = vi.fn<Inner>((_opts, cb) => {
      cb(null, socket);
    });
    const connect = createPinnedConnector({
      pinnedIp: '93.184.216.34',
      servername: 'kolo-shop.cz',
      buildConnector: factory(inner),
    });
    const error = await new Promise<unknown>((resolve) => {
      connect({ hostname: 'kolo-shop.cz', protocol: 'https:', port: 443 }, (e) => resolve(e));
    });
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ code: 'brand_blocked_address' });
  });

  it('protějšek, který sedí, projde', async () => {
    const socket = fakeSocket('93.184.216.34');
    const inner = vi.fn<Inner>((_opts, cb) => {
      cb(null, socket);
    });
    const connect = createPinnedConnector({
      pinnedIp: '93.184.216.34',
      servername: 'kolo-shop.cz',
      buildConnector: factory(inner),
    });
    const result = await new Promise<unknown>((resolve) => {
      connect({ hostname: 'kolo-shop.cz', protocol: 'https:', port: 443 }, (_e, s) => resolve(s));
    });
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(result).toBe(socket);
  });

  it('chyba z podkladového konektoru se propustí beze změny', async () => {
    const inner = vi.fn<Inner>((_opts, cb) => {
      cb(new Error('ECONNREFUSED'), null);
    });
    const connect = createPinnedConnector({
      pinnedIp: '93.184.216.34',
      servername: 'kolo-shop.cz',
      buildConnector: factory(inner),
    });
    const error = await new Promise<unknown>((resolve) => {
      connect({ hostname: 'kolo-shop.cz', protocol: 'https:', port: 443 }, (e) => resolve(e));
    });
    expect((error as Error).message).toBe('ECONNREFUSED');
  });
});
