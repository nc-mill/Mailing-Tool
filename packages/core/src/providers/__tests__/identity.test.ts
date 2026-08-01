import { describe, expect, it } from 'vitest';
// Fixture vlastní tenhle plán, viz rozhodnutí R4 a poznámka v `account.test.ts`.
import custom from './fixtures/ses/get-email-identity-custom-hosted-zone.json' with { type: 'json' };
import { normalizeDomain, buildDnsRecords, mapIdentity } from '../ses/identity';

describe('odesilaci domena', () => {
  it.each([
    ['https://WWW.Example.CZ/', 'example.cz'],
    ['example.cz.', 'example.cz'],
    ['  Example.CZ ', 'example.cz'],
  ])('normalizuje %s na %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it('verejny sufix se odmita', () => {
    expect(() => normalizeDomain('co.uk')).toThrowError(/registrovatelná doména/);
  });

  it('CNAME hodnota se sklada ze SigningHostedZone z API, ne natvrdo', () => {
    const identity = mapIdentity(custom as never);
    expect(identity.dkim_hosted_zone).toBe('a31d.dkim.us-west-2.amazonses.com');
    const records = buildDnsRecords({
      domain: 'example.cz',
      tokens: identity.dkim_tokens,
      hostedZone: identity.dkim_hosted_zone!,
      region: 'us-west-2',
      mailFromSubdomain: null,
    });
    expect(records.find((r) => r.purpose === 'dkim')!.value).toContain(
      'a31d.dkim.us-west-2.amazonses.com',
    );
    expect(JSON.stringify(records)).not.toContain('"dkim.amazonses.com"');
  });

  it('zakladni sada je pet zaznamu: tri DKIM, SPF, DMARC', () => {
    const records = buildDnsRecords({
      domain: 'example.cz',
      tokens: ['a', 'b', 'c'],
      hostedZone: 'dkim.amazonses.com',
      region: 'eu-central-1',
      mailFromSubdomain: null,
    });
    expect(records).toHaveLength(5);
    expect(records.filter((r) => r.purpose === 'dkim')).toHaveLength(3);
  });

  it('s vlastni MAIL FROM je zaznamu sest a SPF se stehuje na subdomenu', () => {
    const records = buildDnsRecords({
      domain: 'example.cz',
      tokens: ['a', 'b', 'c'],
      hostedZone: 'dkim.amazonses.com',
      region: 'eu-central-1',
      mailFromSubdomain: 'mail',
    });
    expect(records).toHaveLength(6);
    expect(records.find((r) => r.purpose === 'spf')!.name).toBe('mail.example.cz');
    expect(records.find((r) => r.purpose === 'mail_from_mx')!.value).toBe(
      '10 feedback-smtp.eu-central-1.amazonses.com',
    );
  });

  it('DMARC zacina na p=none, nikdy na p=reject', () => {
    const records = buildDnsRecords({
      domain: 'example.cz',
      tokens: ['a', 'b', 'c'],
      hostedZone: 'dkim.amazonses.com',
      region: 'eu-central-1',
      mailFromSubdomain: null,
    });
    const dmarc = records.find((r) => r.purpose === 'dmarc')!;
    expect(dmarc.value).toContain('p=none');
    expect(dmarc.value).not.toContain('p=reject');
    expect(dmarc.required).toBe(false);
  });

  it('nazev DKIM zaznamu nikdy nezacina podtrzitkem navic', () => {
    const records = buildDnsRecords({
      domain: 'example.cz',
      tokens: ['x7k2m'],
      hostedZone: 'dkim.amazonses.com',
      region: 'eu-central-1',
      mailFromSubdomain: null,
    });
    expect(records[0]!.name).toBe('x7k2m._domainkey.example.cz');
  });
});
