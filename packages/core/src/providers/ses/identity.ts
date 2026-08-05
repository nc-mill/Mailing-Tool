import psl from 'psl';
import { ApiError } from '../../errors/api-error';

export type DnsRecord = {
  type: 'CNAME' | 'TXT' | 'MX';
  name: string;
  value: string;
  ttl: number;
  purpose: 'dkim' | 'spf' | 'dmarc' | 'mail_from_mx';
  required: boolean;
};

/**
 * Vstup od uživatele na registrovatelnou doménu.
 *
 * Neregistrovatelný vstup je CHYBA UŽIVATELE, ne pád serveru. Dokud se tady
 * házela obyčejná `Error`, skončil `co.uk` (veřejná přípona, doména se pod ní
 * jen registruje) nebo `localhost` jako 500 `internal_error` a uživatel dostal
 * „něco se pokazilo" místo rady. `ApiError('validation_failed')` se přeloží na
 * 422 s cestou na pole `domain`, takže se hláška ukáže rovnou u vyplněného pole.
 */
export function normalizeDomain(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  const parsed = psl.parse(cleaned);
  if ('error' in parsed || !parsed.domain) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'domain',
          code: 'invalid_value',
          message: `${cleaned} není registrovatelná doména.`,
        },
      ],
      params: { domain: cleaned },
    });
  }
  return cleaned;
}

export type SesIdentityResponse = {
  DkimAttributes?: { Tokens?: string[]; SigningHostedZone?: string; Status?: string };
  VerificationStatus?: string;
  MailFromAttributes?: { MailFromDomain?: string; MailFromDomainStatus?: string };
};

export function mapIdentity(r: SesIdentityResponse) {
  return {
    dkim_tokens: r.DkimAttributes?.Tokens ?? [],
    dkim_hosted_zone: r.DkimAttributes?.SigningHostedZone ?? null,
    dkim_status: (r.DkimAttributes?.Status ?? 'NOT_STARTED').toLowerCase().replace(/_/g, '_'),
    ses_verification_status: r.VerificationStatus ?? null,
    mail_from_subdomain: r.MailFromAttributes?.MailFromDomain?.split('.')[0] ?? null,
    mail_from_status: r.MailFromAttributes?.MailFromDomainStatus ?? null,
  };
}

/**
 * SigningHostedZone je typicky dkim.amazonses.com, ale v nekterych regionech a celach
 * ma tvar <cell>.dkim.<region>.amazonses.com. Hodnotu NIKDY neskladame natvrdo,
 * vzdy ji bereme z odpovedi API. Je to casta chyba a v novejsich regionech vede
 * k domene, ktera se nikdy neoveri.
 */
export function buildDnsRecords(input: {
  domain: string;
  tokens: string[];
  hostedZone: string;
  region: string;
  mailFromSubdomain: string | null;
}): DnsRecord[] {
  const records: DnsRecord[] = input.tokens.map((token) => ({
    type: 'CNAME',
    name: `${token}._domainkey.${input.domain}`,
    value: `${token}.${input.hostedZone}`,
    ttl: 1800,
    purpose: 'dkim',
    required: true,
  }));

  const spfHost = input.mailFromSubdomain
    ? `${input.mailFromSubdomain}.${input.domain}`
    : input.domain;
  records.push({
    type: 'TXT',
    name: spfHost,
    value: 'v=spf1 include:amazonses.com ~all',
    ttl: 1800,
    purpose: 'spf',
    required: true,
  });

  if (input.mailFromSubdomain) {
    records.push({
      type: 'MX',
      name: spfHost,
      value: `10 feedback-smtp.${input.region}.amazonses.com`,
      ttl: 1800,
      purpose: 'mail_from_mx',
      required: true,
    });
  }

  // DMARC je jediny ze zaznamu, ktery muze USKODIT, kdyz se nastavi spatne. Prisna
  // politika muze zablokovat firemni maily z jinych systemu, treba fakturacnich.
  // Zacatecnikovi proto nikdy nedoporucujeme p=reject.
  records.push({
    type: 'TXT',
    name: `_dmarc.${input.domain}`,
    value: `v=DMARC1; p=none; rua=mailto:dmarc@${input.domain}; pct=100; adkim=r; aspf=r`,
    ttl: 1800,
    purpose: 'dmarc',
    required: false,
  });

  return records;
}
