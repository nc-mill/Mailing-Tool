export const BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.intranet',
  '.lan',
  '.corp',
  '.home.arpa',
  '.localdomain',
  '.onion',
  '.test',
  '.invalid',
  '.example',
] as const;

/** Jména, která odmítáme celá, ne jako příponu. */
const BLOCKED_EXACT_HOSTS = ['localhost'] as const;

export const MAX_URL_LENGTH = 2048;

export type UrlPolicy = {
  allowHttp: boolean;
  blockedHosts: readonly string[];
  allowedHosts: readonly string[];
};

export type NormalizeResult =
  | { ok: true; url: string; hostname: string; protocol: 'http:' | 'https:' }
  | {
      ok: false;
      code:
        | 'brand_invalid_url'
        | 'brand_scheme_not_allowed'
        | 'brand_credentials_in_url'
        | 'brand_port_not_allowed'
        | 'brand_host_not_allowed';
    };

function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function normalizeBrandUrl(input: string, policy: UrlPolicy): NormalizeResult {
  if (input.length > MAX_URL_LENGTH) return { ok: false, code: 'brand_invalid_url' };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: 'brand_invalid_url' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, code: 'brand_scheme_not_allowed' };
  }
  if (url.protocol === 'http:' && !policy.allowHttp) {
    return { ok: false, code: 'brand_scheme_not_allowed' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, code: 'brand_credentials_in_url' };
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    return { ok: false, code: 'brand_port_not_allowed' };
  }

  // Tečka na konci se odebere, jinak by `example.local.` obešel suffixovou kontrolu.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === '') return { ok: false, code: 'brand_invalid_url' };
  url.hostname = hostname;

  if (BLOCKED_EXACT_HOSTS.includes(hostname as (typeof BLOCKED_EXACT_HOSTS)[number])) {
    return { ok: false, code: 'brand_host_not_allowed' };
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, code: 'brand_host_not_allowed' };
  }
  if (policy.blockedHosts.some((blocked) => hostMatches(hostname, blocked.toLowerCase()))) {
    return { ok: false, code: 'brand_host_not_allowed' };
  }
  if (
    policy.allowedHosts.length > 0 &&
    !policy.allowedHosts.some((allowed) => hostMatches(hostname, allowed.toLowerCase()))
  ) {
    return { ok: false, code: 'brand_host_not_allowed' };
  }

  // Fragment se zahazuje, query se zachovává.
  url.hash = '';
  // Výchozí port se z kanonického tvaru odstraní sám.
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  return {
    ok: true,
    url: url.toString(),
    hostname,
    protocol: url.protocol as 'http:' | 'https:',
  };
}
