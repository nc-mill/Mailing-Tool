import { describe, expect, it, vi } from 'vitest';
import { resolveHostSafely } from './resolve';

const resolver = (v4: string[], v6: string[] = []) => ({
  resolve4: vi.fn(async () => v4),
  resolve6: vi.fn(async () => v6),
  setServers: vi.fn(),
});

describe('rozlišení jmen', () => {
  it('vrátí ověřené adresy pro veřejný host', async () => {
    const result = await resolveHostSafely('kolo-shop.cz', {
      resolver: resolver(['93.184.216.34']),
      timeoutMs: 2000,
    });
    expect(result).toEqual({ ok: true, addresses: ['93.184.216.34'] });
  });

  it('IP literál DNS přeskočí a zkontroluje se přímo', async () => {
    const r = resolver([]);
    const result = await resolveHostSafely('93.184.216.34', { resolver: r, timeoutMs: 2000 });
    expect(result).toEqual({ ok: true, addresses: ['93.184.216.34'] });
    expect(r.resolve4).not.toHaveBeenCalled();
  });

  it('IP literál v zakázaném rozsahu se odmítne bez DNS', async () => {
    const r = resolver([]);
    const result = await resolveHostSafely('169.254.169.254', { resolver: r, timeoutMs: 2000 });
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
    expect(r.resolve4).not.toHaveBeenCalled();
  });

  it('T7: když je mezi vrácenými adresami jediná zakázaná, odmítne se celý požadavek', async () => {
    const result = await resolveHostSafely('rebind.example', {
      resolver: resolver(['93.184.216.34', '127.0.0.1']),
      timeoutMs: 2000,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
  });

  it('žádná vrácená adresa je brand_dns_failed', async () => {
    const result = await resolveHostSafely('neexistuje.example', {
      resolver: resolver([], []),
      timeoutMs: 2000,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_dns_failed' });
  });

  it('chyba resolveru je brand_dns_failed, ne prasknutí', async () => {
    const failing = {
      resolve4: vi.fn(async (): Promise<string[]> => {
        throw new Error('ENOTFOUND');
      }),
      resolve6: vi.fn(async (): Promise<string[]> => {
        throw new Error('ENOTFOUND');
      }),
      setServers: vi.fn(),
    };
    const result = await resolveHostSafely('neexistuje.example', {
      resolver: failing,
      timeoutMs: 2000,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_dns_failed' });
  });

  it('vlastní servery se nastaví jen tehdy, když jsou vyplněné', async () => {
    const r = resolver(['93.184.216.34']);
    await resolveHostSafely('kolo-shop.cz', { resolver: r, timeoutMs: 2000 });
    expect(r.setServers).not.toHaveBeenCalled();

    const r2 = resolver(['93.184.216.34']);
    await resolveHostSafely('kolo-shop.cz', {
      resolver: r2,
      timeoutMs: 2000,
      dnsServers: ['1.1.1.1'],
    });
    expect(r2.setServers).toHaveBeenCalledWith(['1.1.1.1']);
  });

  it('kombinuje IPv4 i IPv6 a obě sady kontroluje', async () => {
    const result = await resolveHostSafely('dual.example', {
      resolver: resolver(['93.184.216.34'], ['2606:4700:4700::1111']),
      timeoutMs: 2000,
    });
    expect(result).toEqual({ ok: true, addresses: ['93.184.216.34', '2606:4700:4700::1111'] });
  });

  it('zakázaná IPv6 mezi výsledky shodí celý požadavek', async () => {
    const result = await resolveHostSafely('dual.example', {
      resolver: resolver(['93.184.216.34'], ['fd00:ec2::254']),
      timeoutMs: 2000,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
  });
});
