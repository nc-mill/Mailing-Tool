import type { DnsResolver, Finding } from './resolver';
import { unknownOnServfail } from './resolver';

/**
 * Nejcastejsi duvod, proc zaznam nefunguje: v jednom panelu se zadava
 * x7k2m._domainkey, v jinem x7k2m._domainkey.kolo-shop.cz, a kdyz se to plete,
 * vznikne x7k2m._domainkey.kolo-shop.cz.kolo-shop.cz. Tuhle konkretni chybu
 * detekujeme a hlasime jmenovite.
 */
export async function checkDkim(
  resolver: DnsResolver,
  input: { domain: string; tokens: string[]; hostedZone: string },
): Promise<{ ok: boolean | null; found: number; expected: number; findings: Finding[] }> {
  const findings: Finding[] = [];
  let found = 0;
  let unknown = false;

  for (const token of input.tokens) {
    const name = `${token}._domainkey.${input.domain}`;
    const expected = `${token}.${input.hostedZone}`.toLowerCase();
    try {
      const values = await resolver.resolveCname(name);
      const normalized = values.map((v) => v.toLowerCase().replace(/\.$/, ''));
      if (normalized.includes(expected)) found += 1;
      else
        findings.push({
          code: 'dkim_wrong_value',
          severity: 'error',
          params: { name, expected, actual: normalized[0] ?? '' },
        });
    } catch (err) {
      if (unknownOnServfail(err)) {
        unknown = true;
        continue;
      }
      try {
        const doubled = `${token}._domainkey.${input.domain}.${input.domain}`;
        await resolver.resolveCname(doubled);
        findings.push({
          code: 'dkim_name_duplicated',
          severity: 'error',
          params: { found: doubled, expected: `${token}._domainkey` },
        });
      } catch {
        findings.push({ code: 'dkim_missing', severity: 'error', params: { name } });
      }
    }
  }

  if (unknown && found < input.tokens.length) {
    return {
      ok: null,
      found,
      expected: input.tokens.length,
      findings: [{ code: 'dkim_unknown', severity: 'warning' }],
    };
  }
  if (found === input.tokens.length) {
    return { ok: true, found, expected: input.tokens.length, findings: [] };
  }
  if (found > 0) {
    findings.unshift({
      code: 'dkim_partial',
      severity: 'error',
      params: { found, expected: input.tokens.length },
    });
  }
  return { ok: false, found, expected: input.tokens.length, findings };
}
