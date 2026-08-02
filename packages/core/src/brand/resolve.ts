import { isIP } from 'node:net';
import { classifyAddress, type ClassifyOptions } from './address';

/**
 * DNS se dělá EXPLICITNĚ přes `dns.promises.Resolver` a metody `resolve4()`
 * a `resolve6()`, nikoliv přes `lookup()`. Rozdíl je zásadní: `lookup()`
 * konzultuje `/etc/hosts` a systémové vyhledávací domény, takže `intranet`
 * by se mohlo přeložit na vnitřní adresu bez toho, aby to bylo v URL vidět.
 */
export type MinimalResolver = {
  resolve4: (hostname: string) => Promise<string[]>;
  resolve6: (hostname: string) => Promise<string[]>;
  setServers: (servers: string[]) => void;
};

export type ResolveOptions = ClassifyOptions & {
  resolver: MinimalResolver;
  timeoutMs: number;
  dnsServers?: readonly string[] | undefined;
};

export type ResolveResult =
  | { ok: true; addresses: string[] }
  | { ok: false; code: 'brand_dns_failed' | 'brand_blocked_address' };

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('dns timeout')), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

export async function resolveHostSafely(
  hostname: string,
  options: ResolveOptions,
): Promise<ResolveResult> {
  // Když je hostname už IP literál, DNS se přeskočí a kontroluje se přímo.
  if (isIP(hostname) !== 0) {
    const verdict = classifyAddress(hostname, options);
    return verdict.allowed
      ? { ok: true, addresses: [hostname] }
      : { ok: false, code: 'brand_blocked_address' };
  }

  if (options.dnsServers !== undefined && options.dnsServers.length > 0) {
    options.resolver.setServers([...options.dnsServers]);
  }

  const [v4, v6] = await Promise.all([
    withTimeout(options.resolver.resolve4(hostname), options.timeoutMs).catch(() => [] as string[]),
    withTimeout(options.resolver.resolve6(hostname), options.timeoutMs).catch(() => [] as string[]),
  ]);

  const addresses = [...v4, ...v6];
  if (addresses.length === 0) return { ok: false, code: 'brand_dns_failed' };

  // Kontrolují se VŠECHNY vrácené adresy. Nefiltrujeme: přítomnost zakázané
  // adresy v odpovědi je sama o sobě signál pokusu o rebinding.
  for (const address of addresses) {
    if (!classifyAddress(address, options).allowed) {
      return { ok: false, code: 'brand_blocked_address' };
    }
  }

  return { ok: true, addresses };
}
