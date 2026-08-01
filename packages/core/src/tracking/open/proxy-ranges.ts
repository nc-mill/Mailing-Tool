import ipaddr from 'ipaddr.js';

export type ProxyProvider = 'apple_private_relay' | 'google' | 'manual';
export type ProxyRange = { provider: ProxyProvider; cidr: string };

/** Účel je součástí podpisu schválně, viz 3.3.3: seznam se nikdy nesmí použít na web. */
export type ProxyMatchPurpose = 'email_open';

/**
 * Apple drží celý blok 17.0.0.0/8. Platí vždy, i když je stahování seznamu vypnuté,
 * protože to není stažená informace, ale veřejně známé přidělení adresního prostoru.
 */
export const APPLE_FIXED_CIDR = '17.0.0.0/8';

type ParsedRange = { provider: ProxyProvider; range: [ipaddr.IPv4 | ipaddr.IPv6, number] };

export type ProxyRangeIndexOptions = { useAppleRelayRanges?: boolean };

export class ProxyRangeIndex {
  readonly #v4: ParsedRange[] = [];
  readonly #v6: ParsedRange[] = [];

  constructor(ranges: readonly ProxyRange[], options: ProxyRangeIndexOptions = {}) {
    const useApple = options.useAppleRelayRanges ?? false;
    const effective: ProxyRange[] = [{ provider: 'apple_private_relay', cidr: APPLE_FIXED_CIDR }];

    for (const range of ranges) {
      if (range.provider === 'apple_private_relay' && !useApple) continue;
      effective.push(range);
    }

    for (const entry of effective) {
      let parsed: [ipaddr.IPv4 | ipaddr.IPv6, number];
      try {
        parsed = ipaddr.parseCIDR(entry.cidr);
      } catch {
        continue; // vadný rozsah v tabulce nesmí shodit klasifikaci
      }
      const bucket = parsed[0].kind() === 'ipv4' ? this.#v4 : this.#v6;
      bucket.push({ provider: entry.provider, range: parsed });
    }
  }

  match(ip: string, purpose: ProxyMatchPurpose): ProxyProvider | null {
    if (purpose !== 'email_open') return null;
    let address: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      address = ipaddr.parse(ip);
    } catch {
      return null;
    }
    const bucket = address.kind() === 'ipv4' ? this.#v4 : this.#v6;
    for (const entry of bucket) {
      if (address.match(entry.range as never)) return entry.provider;
    }
    return null;
  }

  /** Formát `cidr,country,region,city,` s prázdným posledním polem. */
  static parseAppleCsv(csv: string): string[] {
    const out: string[] = [];
    for (const line of csv.split('\n')) {
      const cidr = line.split(',')[0]?.trim();
      if (cidr === undefined || cidr === '') continue;
      out.push(cidr);
    }
    return out;
  }
}
