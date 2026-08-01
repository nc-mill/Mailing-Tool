import type { CheckResult, DnsResolver, Finding } from './resolver';
import { unknownOnServfail } from './resolver';

const LOOKUP_MECHANISMS = /\b(include|a|mx|ptr|exists|redirect)[:=]/g;

export async function checkSpf(
  resolver: DnsResolver,
  host: string,
): Promise<CheckResult & { record: string | null }> {
  let txt: string[][];
  try {
    txt = await resolver.resolveTxt(host);
  } catch (err) {
    if (unknownOnServfail(err)) {
      return { ok: null, record: null, findings: [{ code: 'spf_unknown', severity: 'warning' }] };
    }
    return { ok: false, record: null, findings: [{ code: 'spf_missing', severity: 'error' }] };
  }

  // TXT zaznamy jsou pole poli retezcu, jednotlive casti se spojuji BEZ oddelovace.
  const records = txt.map((parts) => parts.join('')).filter((r) => /^v=spf1\b/i.test(r));

  if (records.length === 0) {
    return { ok: false, record: null, findings: [{ code: 'spf_missing', severity: 'error' }] };
  }
  if (records.length > 1) {
    return {
      ok: false,
      record: records[0]!,
      findings: [
        { code: 'spf_multiple_records', severity: 'error', params: { count: records.length } },
      ],
    };
  }

  const record = records[0]!;
  const findings: Finding[] = [];

  const hasAmazon = /include:amazonses\.com/i.test(record) || /\bip[46]:/i.test(record);
  if (!hasAmazon) {
    return { ok: false, record, findings: [{ code: 'spf_no_amazon', severity: 'error' }] };
  }
  if (/\+all\s*$/i.test(record)) {
    findings.push({ code: 'spf_permissive_all', severity: 'warning' });
  }

  const lookups = (record.match(LOOKUP_MECHANISMS) ?? []).length;
  if (lookups > 10) {
    findings.push({ code: 'spf_too_many_lookups', severity: 'warning', params: { lookups } });
  }

  return { ok: true, record, findings };
}
