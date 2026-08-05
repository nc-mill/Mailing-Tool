import psl from 'psl';
import type { DnsResolver, Finding } from './resolver';
import { unknownOnServfail } from './resolver';

export type DmarcResult = {
  ok: boolean | null;
  record: string | null;
  policy: 'none' | 'quarantine' | 'reject' | null;
  pct: number | null;
  color: 'green' | 'yellow' | 'red' | 'grey';
  findings: Finding[];
};

export async function checkDmarc(
  resolver: DnsResolver,
  host: string,
  opts: { hasCustomMailFrom?: boolean } = {},
): Promise<DmarcResult> {
  const parsed = psl.parse(host);
  const org = 'domain' in parsed && parsed.domain ? parsed.domain : host;

  let txt: string[][];
  try {
    txt = await resolver.resolveTxt(`_dmarc.${org}`);
  } catch (err) {
    if (unknownOnServfail(err)) {
      return {
        ok: null,
        record: null,
        policy: null,
        pct: null,
        color: 'grey',
        findings: [{ code: 'dmarc_unknown', severity: 'warning' }],
      };
    }
    return {
      ok: false,
      record: null,
      policy: null,
      pct: null,
      color: 'red',
      findings: [{ code: 'dmarc_missing', severity: 'error', params: { host: `_dmarc.${org}` } }],
    };
  }

  const records = txt.map((p) => p.join('')).filter((r) => /^v=DMARC1\b/i.test(r));
  if (records.length === 0) {
    return {
      ok: false,
      record: null,
      policy: null,
      pct: null,
      color: 'red',
      findings: [{ code: 'dmarc_missing', severity: 'error', params: { host: `_dmarc.${org}` } }],
    };
  }
  if (records.length > 1) {
    return {
      ok: false,
      record: records[0]!,
      policy: null,
      pct: null,
      color: 'red',
      findings: [
        {
          code: 'dmarc_multiple_records',
          severity: 'error',
          params: { actual: records.join(' | ') },
        },
      ],
    };
  }

  const record = records[0]!;
  const tags = Object.fromEntries(
    record
      .split(';')
      .map((p) => p.trim().split('='))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k!.toLowerCase(), v!.trim()]),
  );
  /*
   * Hodnoty tagu se porovnavaji BEZ ohledu na velikost pismen. ABNF v RFC 7489 6.3
   * zapisuje `p` jako literal ("none" / "quarantine" / "reject") a literaly jsou
   * podle RFC 5234 2.3 case-insensitive. `p=REJECT` je tedy platna, prisna politika.
   * Drive ji kontrola odmitla jako `dmarc_invalid_syntax`, tedy nejlepe nastavenou
   * domenu ze vsech oznacila za rozbitou. Predpona `v=DMARC1` se uz case-insensitive
   * porovnavala, takze to bylo navic nekonzistentni samo se sebou.
   */
  const policy = tags.p?.toLowerCase() as DmarcResult['policy'];
  if (!policy || !['none', 'quarantine', 'reject'].includes(policy)) {
    return {
      ok: false,
      record,
      policy: null,
      pct: null,
      color: 'red',
      findings: [
        { code: 'dmarc_invalid_syntax', severity: 'error', params: { tag: 'p', actual: record } },
      ],
    };
  }

  /*
   * Od tohohle mista je zaznam PLATNY a kontrola koncí `ok: true`. Nas doporuceny
   * text (`p=none; rua=...; pct=100; adkim=r; aspf=r`) je DOPORUCENI, ne predpis:
   * jina politika, jine `rua`, jina zarovnani i chybejici volitelne tagy jsou
   * v poradku a nesmi se hlasit jako chyba. Nalezy nize jsou rady, ne zamitnuti.
   */
  const pct = tags.pct ? Number(tags.pct) : 100;
  const findings: Finding[] = [];
  if (policy === 'none') {
    findings.push({ code: 'dmarc_policy_none', severity: 'warning', params: { actual: record } });
  }
  if (pct < 100) findings.push({ code: 'dmarc_partial_pct', severity: 'warning', params: { pct } });
  if (tags.aspf?.toLowerCase() === 's' && opts.hasCustomMailFrom === false) {
    findings.push({ code: 'dmarc_spf_alignment_strict', severity: 'warning' });
  }

  const color: DmarcResult['color'] = policy === 'none' || pct < 100 ? 'yellow' : 'green';
  return { ok: true, record, policy, pct, color, findings };
}
