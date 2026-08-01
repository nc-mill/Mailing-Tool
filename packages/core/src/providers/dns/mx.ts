import type { DnsResolver, Finding } from './resolver';

/**
 * Kdyz MX chybi a BehaviorOnMxFailure je USE_DEFAULT_VALUE, hlasi se VAROVANI, ne chyba,
 * protoze SES v tom pripade pouzije vlastni domenu a maily odejdou.
 */
export async function checkMx(
  resolver: DnsResolver,
  input: { mailFromDomain: string; region: string },
): Promise<{ ok: boolean | null; records: string[]; findings: Finding[] }> {
  const expected = `feedback-smtp.${input.region}.amazonses.com`;
  try {
    const mx = await resolver.resolveMx(input.mailFromDomain);
    const records = mx.map((m) => m.exchange.toLowerCase().replace(/\.$/, ''));
    if (records.includes(expected)) return { ok: true, records, findings: [] };
    return {
      ok: false,
      records,
      findings: [{ code: 'mail_from_mx_wrong', severity: 'warning', params: { expected } }],
    };
  } catch {
    return {
      ok: false,
      records: [],
      findings: [{ code: 'mail_from_mx_missing', severity: 'warning', params: { expected } }],
    };
  }
}
