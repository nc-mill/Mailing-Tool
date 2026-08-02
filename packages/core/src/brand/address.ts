import ipaddr from 'ipaddr.js';
import { BLOCKED_RANGES, isBlockedAddress } from '../net/ssrf';

/**
 * Kontrola je allowlist naruby: adresa musí být globálně směrovatelná unicast
 * adresa, cokoliv jiného padá.
 *
 * Seznam rozsahů je fakt o IP adresách, ne rozhodnutí produktu, a proto je
 * SDÍLENÝ s odchozími webhooky. Sdílený znamená IMPORTOVANÝ, ne opsaný:
 * dva seznamy proti téže hrozbě se rozejdou a tichý rozdíl v bezpečnostním
 * blocklistu je horší než žádné sdílení.
 */
export type IpVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'private' | 'loopback' | 'link_local' | 'metadata' | 'reserved' | 'multicast';
    };

export type ClassifyOptions = {
  /**
   * Existuje pro provozovatele, kteří nástroj používají uvnitř firemní sítě
   * na vlastní intranetový web. Loopback, link-local a metadata zůstávají
   * zakázané i tak: nejsou to „privátní sítě", jsou to cíle útoku.
   */
  allowPrivateNetworks?: boolean;
};

type BlockReason = 'private' | 'loopback' | 'link_local' | 'reserved' | 'multicast';

/**
 * Důvody k rozsahům, které vlastní P04. Seznam rozsahů se NEOPISUJE: bere se
 * z `BLOCKED_RANGES` a tady se k němu jen dopisuje důvod, protože P04 sám
 * důvody nevede (webhookům stačí ano/ne, extrakce značky je hlásí do UI).
 *
 * Rozsah, který v P04 přibude a tady nebude mít důvod, dostane `reserved`
 * a zůstane zakázaný. Poslední test souboru `address.test.ts` ověřuje, že
 * žádný rozsah z P04 neprojde jako povolený.
 */
const REASON_BY_RANGE: Record<string, BlockReason> = {
  '0.0.0.0/8': 'reserved',
  '10.0.0.0/8': 'private',
  '100.64.0.0/10': 'private',
  '127.0.0.0/8': 'loopback',
  '169.254.0.0/16': 'link_local',
  '172.16.0.0/12': 'private',
  '192.0.0.0/24': 'reserved',
  '192.168.0.0/16': 'private',
  '198.18.0.0/15': 'reserved',
  '224.0.0.0/4': 'multicast',
  '240.0.0.0/4': 'reserved',
  '::1/128': 'loopback',
  'fc00::/7': 'private',
  'fe80::/10': 'link_local',
  '::ffff:0:0/96': 'reserved',
};

/**
 * Rozsahy, které extrakce značky potřebuje navíc oproti odchozím webhookům.
 * Webhook míří na adresu, kterou zadal správce projektu jednou; extrakce míří
 * na adresu z cizí stránky, takže dokumentační a testovací rozsahy jsou tu
 * reálný vektor, ne teorie.
 */
const V4_EXTRA: ReadonlyArray<readonly [string, number, BlockReason]> = [
  ['192.0.2.0', 24, 'reserved'],
  ['192.88.99.0', 24, 'reserved'],
  ['198.51.100.0', 24, 'reserved'],
  ['203.0.113.0', 24, 'reserved'],
];

const V6_EXTRA: ReadonlyArray<readonly [string, number, BlockReason]> = [
  ['::', 128, 'reserved'],
  ['100::', 64, 'reserved'],
  ['2001::', 23, 'reserved'],
  ['2001:db8::', 32, 'reserved'],
  ['ff00::', 8, 'multicast'],
];

type ParsedAddress = ipaddr.IPv4 | ipaddr.IPv6;

/**
 * Poslední dvě skupiny IPv6 adresy jako IPv4. `IPv6.toIPv4Address()` se použít
 * nedá: v ipaddr.js hází u všeho, co není `::ffff:`-mapovaná adresa, takže by
 * `::` i `::1` shodily celou klasifikaci výjimkou místo verdiktu.
 */
function lastTwoGroupsAsV4(parts: readonly number[]): ipaddr.IPv4 | null {
  const high = parts[6];
  const low = parts[7];
  if (high === undefined || low === undefined) return null;
  return new ipaddr.IPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
}

/** `match` mezi různými rodinami adres v ipaddr.js hází, proto ta kontrola. */
function matchesRange(address: ParsedAddress, network: string, bits: number): boolean {
  let target: ParsedAddress;
  try {
    target = ipaddr.parse(network);
  } catch {
    return false;
  }
  if (address.kind() !== target.kind()) return false;
  return address.match(target as never, bits);
}

/** Důvod pro adresu, kterou už P04 označil za zakázanou. */
function reasonFromSharedList(address: ParsedAddress): BlockReason {
  for (const range of BLOCKED_RANGES) {
    const [network, bits] = range.split('/');
    if (network === undefined || bits === undefined) continue;
    if (matchesRange(address, network, Number(bits))) {
      return REASON_BY_RANGE[range] ?? 'reserved';
    }
  }
  return 'reserved';
}

/** Rozsahy, které zůstávají zakázané i při `allowPrivateNetworks`. */
const NEVER_ALLOWED_REASONS = new Set<BlockReason>([
  'loopback',
  'link_local',
  'multicast',
  'reserved',
]);

function verdictFor(reason: BlockReason, options: ClassifyOptions): IpVerdict {
  if (options.allowPrivateNetworks === true && !NEVER_ALLOWED_REASONS.has(reason)) {
    return { allowed: true };
  }
  return { allowed: false, reason };
}

/**
 * Společné vyhodnocení pro obě rodiny adres. Pořadí je podstatné:
 *   1) sdílený blocklist P04 (jediný zdroj rozsahů, které platí i pro webhooky)
 *   2) rozsahy navíc, specifické pro extrakci značky
 * Teprve když adresa neodpovídá ani jednomu, je povolená.
 */
function classifyAgainstLists(
  address: ParsedAddress,
  extra: ReadonlyArray<readonly [string, number, BlockReason]>,
  options: ClassifyOptions,
): IpVerdict {
  if (isBlockedAddress(address.toString())) {
    return verdictFor(reasonFromSharedList(address), options);
  }

  for (const [network, bits, reason] of extra) {
    if (matchesRange(address, network, bits)) return verdictFor(reason, options);
  }

  return { allowed: true };
}

function classifyV4(address: ipaddr.IPv4, options: ClassifyOptions): IpVerdict {
  if (address.toString() === '255.255.255.255') return { allowed: false, reason: 'reserved' };
  return classifyAgainstLists(address, V4_EXTRA, options);
}

/** Vnořená IPv4 v 6to4 (`2002::/16`) a v NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`). */
function extractNestedV4(address: ipaddr.IPv6): ipaddr.IPv4 | null {
  const parts = address.parts;

  if (matchesRange(address, '2002::', 16)) {
    const high = parts[1];
    const low = parts[2];
    if (high === undefined || low === undefined) return null;
    return new ipaddr.IPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  if (matchesRange(address, '64:ff9b::', 96) || matchesRange(address, '64:ff9b:1::', 48)) {
    return lastTwoGroupsAsV4(parts);
  }
  return null;
}

export function classifyAddress(ip: string, options: ClassifyOptions = {}): IpVerdict {
  let parsed: ParsedAddress;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    // Nerozpoznaný vstup se nikdy nepovoluje. Chyba parseru není důvod pustit
    // požadavek ven.
    return { allowed: false, reason: 'reserved' };
  }

  if (parsed.kind() === 'ipv4') return classifyV4(parsed as ipaddr.IPv4, options);

  const v6 = parsed as ipaddr.IPv6;

  /*
   * ODCHYLKA OD PLÁNU, vynucená testem. Plán rozbaloval IPv4-compatible
   * (`::/96`) DŘÍV, než se ptal sdíleného blocklistu. Jenže `::1` do `::/96`
   * spadá taky, takže by se loopback rozbalil na `0.0.0.1` a ohlásil se jako
   * `reserved` místo `loopback`.
   *
   * Pořadí je proto: mapovaná IPv4 (má vlastní IPv4 tabulku), pak sdílený
   * blocklist v IPv6 podobě (`::1`, `fc00::/7`, `fe80::/10`), a teprve pak
   * rozbalení vnořených tvarů.
   */
  if (v6.isIPv4MappedAddress()) return classifyV4(v6.toIPv4Address(), options);

  if (isBlockedAddress(v6.toString())) {
    return verdictFor(reasonFromSharedList(v6), options);
  }

  if (matchesRange(v6, '::', 96)) {
    const compatible = lastTwoGroupsAsV4(v6.parts);
    if (compatible !== null) return classifyV4(compatible, options);
  }

  const nested = extractNestedV4(v6);
  if (nested !== null) {
    const verdict = classifyV4(nested, options);
    if (!verdict.allowed) return verdict;
  }

  return classifyAgainstLists(v6, V6_EXTRA, options);
}
