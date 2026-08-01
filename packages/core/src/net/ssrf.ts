import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { loadConfig, type MlainConfig } from '../config';

/**
 * 3.8: seznam privátních a nesměrovatelných rozsahů je JEDEN sdílený, protože
 * je to fakt o IP adresách, ne rozhodnutí produktu. Dva seznamy proti téže
 * hrozbě jsou způsob, jak jeden z nich zastará.
 *
 * Politika, jak se seznam použije, je oddělená per volající: odchozí webhooky
 * (tato část) a stahování značky z webu (část 3) mají legitimně různá pravidla.
 */
export const BLOCKED_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  '::ffff:0:0/96',
] as const;

/**
 * ODCHYLKA OD PLÁNU, ověřená spuštěním. Plán držel všech patnáct rozsahů
 * v JEDNOM `BlockList`. To nefunguje: `BlockList` normalizuje IPv4 adresy do
 * v4-mapované podoby, takže podsíť `::ffff:0:0/96` uvnitř téhož seznamu
 * odpoví `true` na KAŽDOU IPv4 adresu, i když se ptáme s rodinou `'ipv4'`.
 *
 * Naměřeno na Node 24:
 *   blockList.addSubnet('::ffff:0:0', 96, 'ipv6');
 *   blockList.check('1.1.1.1', 'ipv4')       // true
 *   blockList.check('93.184.216.34', 'ipv4') // true
 *
 * Blocklist by tedy zablokoval veškerý odchozí provoz a webhooky by nikomu
 * nechodily. Rozsahy proto bydlí ve dvou seznamech podle rodiny a každá adresa
 * se ptá jen toho svého; mapovaná IPv4 se navíc zkontroluje i v IPv4 podobě.
 */
const ipv4BlockList = new BlockList();
const ipv6BlockList = new BlockList();
for (const range of BLOCKED_RANGES) {
  const [address, prefix] = range.split('/');
  const isV6 = address!.includes(':');
  (isV6 ? ipv6BlockList : ipv4BlockList).addSubnet(
    address!,
    Number(prefix),
    isV6 ? 'ipv6' : 'ipv4',
  );
}

export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) return ipv4BlockList.check(address, 'ipv4');
  if (isIPv6(address)) {
    // Mapovaná IPv4 se musí zkontrolovat i v IPv4 podobě, jinak ::ffff:10.0.0.1
    // projde jako "jen jiná IPv6 adresa".
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    if (mapped && ipv4BlockList.check(mapped, 'ipv4')) return true;
    return ipv6BlockList.check(address, 'ipv6');
  }
  return false;
}

export type SsrfPolicy = {
  allowPrivateNetworks: boolean;
  allowHttp: boolean;
  extraBlockedHosts: string[];
  /** Prázdné pole znamená bez allowlistu. */
  allowedHosts: string[];
  maxRedirects: 0 | number;
};

/**
 * ODCHYLKA OD PLÁNU. Plán psal `import { config } from '@mlain/core/config'`
 * a `allowPrivateNetworks: config.WEBHOOK_ALLOW_PRIVATE_TARGETS` jako hodnotu
 * vyhodnocenou při importu modulu. P01 žádný hotový objekt `config` nevydává,
 * jen továrnu `loadConfig()`, a načtení při importu by shodilo každý test, který
 * se modulu jen dotkne. Konfigurace se proto čte líně a memoizuje, stejně jako
 * v `identity/session.ts` a `tx/index.ts`.
 */
let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/**
 * 3.8: webhooky mají přísnější politiku než stahování značky, protože přenášejí
 * podepsané tajemství na adresu zvolenou uživatelem. Přesměrování nenásledujeme
 * vůbec: 307 na interní adresu je klasický SSRF vektor.
 *
 * `allowPrivateNetworks` je getter, ne hodnota. Důvod je tentýž jako u `cfg()`:
 * hodnota se musí přečíst až ve chvíli, kdy o ni někdo požádá. Spread
 * `{ ...WEBHOOK_SSRF_POLICY, allowPrivateNetworks: true }` funguje beze změny,
 * protože spread getter vyhodnotí a výsledkem je obyčejná hodnota.
 */
export const WEBHOOK_SSRF_POLICY: SsrfPolicy = {
  get allowPrivateNetworks(): boolean {
    return cfg().WEBHOOK_ALLOW_PRIVATE_TARGETS;
  },
  allowHttp: false,
  extraBlockedHosts: [],
  allowedHosts: [],
  maxRedirects: 0,
};

export class SsrfBlockedError extends Error {
  readonly code = 'blocked_target';
  constructor(reason: string) {
    super(`blocked_target: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Statická kontrola adresy. Nestačí sama o sobě: jméno se musí ověřit znovu
 * při každém doručení, protože jinak existuje DNS rebinding. Viz safeRequest.
 */
export function assertUrlAllowed(rawUrl: string, policy: SsrfPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('malformed_url');
  }

  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) {
    throw new SsrfBlockedError('schema_not_allowed');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (policy.extraBlockedHosts.some((h) => h.toLowerCase() === host)) {
    throw new SsrfBlockedError('host_blocked');
  }
  if (
    policy.allowedHosts.length > 0 &&
    !policy.allowedHosts.some((h) => h.toLowerCase() === host)
  ) {
    throw new SsrfBlockedError('host_not_allowlisted');
  }
  if (!policy.allowPrivateNetworks && isBlockedAddress(host)) {
    throw new SsrfBlockedError('blocked_address_literal');
  }

  return url;
}
