import type { CompileMeta } from '@mlain/emails/compile/types';
import type { Issue } from '@mlain/emails/issue';

export type PreSendFinding = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  params?: Record<string, string | number> | undefined;
};

export type PreSendInput = {
  compileMeta: Pick<
    CompileMeta,
    'htmlBytes' | 'links' | 'assetIds' | 'warnings' | 'hasUnsubscribeLink'
  >;
  validationIssues: Issue[];
  subject: string;
  preheader: string;
  appUrl: string;
  emptyFieldRatios: Array<{ path: string; empty: number; total: number; hasDefault: boolean }>;
};

export type PreSendResult = { blocking: boolean; findings: PreSendFinding[] };

const HTML_WARN_BYTES = 80 * 1024;
const HTML_ERROR_BYTES = 102 * 1024;

/** Loopback, privátní rozsahy a .local. Nejčastější chyba self-hosted instalace. */
function isPublicUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return false;
  if (host === '127.0.0.1' || host === '::1' || host.startsWith('127.')) return false;
  if (host.startsWith('10.') || host.startsWith('192.168.')) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (!host.includes('.')) return false;
  return true;
}

export function preSendCheck(input: PreSendInput): PreSendResult {
  const findings: PreSendFinding[] = [];

  if (input.validationIssues.some((issue) => issue.severity === 'error')) {
    findings.push({
      code: 'precheck_template_invalid',
      severity: 'error',
      params: { count: input.validationIssues.filter((i) => i.severity === 'error').length },
    });
  }
  if (!input.compileMeta.hasUnsubscribeLink) {
    findings.push({ code: 'precheck_missing_unsubscribe', severity: 'error' });
  }
  if (input.compileMeta.htmlBytes > HTML_ERROR_BYTES) {
    findings.push({
      code: 'precheck_html_too_large',
      severity: 'error',
      params: { bytes: input.compileMeta.htmlBytes },
    });
  } else if (input.compileMeta.htmlBytes > HTML_WARN_BYTES) {
    findings.push({
      code: 'precheck_html_large',
      severity: 'warning',
      params: { bytes: input.compileMeta.htmlBytes },
    });
  }
  if (input.subject.trim() === '')
    findings.push({ code: 'precheck_subject_empty', severity: 'error' });
  if (input.preheader.trim() === '') {
    findings.push({ code: 'precheck_preheader_empty', severity: 'warning' });
  }

  for (const link of input.compileMeta.links) {
    if (link.url.startsWith('http://')) {
      findings.push({
        code: 'precheck_insecure_link',
        severity: 'warning',
        params: { url: link.url },
      });
    }
  }

  if (!isPublicUrl(input.appUrl)) {
    findings.push({
      code: 'precheck_app_url_not_public',
      severity: 'error',
      params: { app_url: input.appUrl },
    });
  }

  for (const ratio of input.emptyFieldRatios) {
    if (ratio.hasDefault || ratio.total === 0) continue;
    const value = ratio.empty / ratio.total;
    if (value <= 0.1) continue;
    findings.push({
      code: 'precheck_empty_field_ratio',
      severity: 'warning',
      params: {
        path: ratio.path,
        empty: ratio.empty,
        total: ratio.total,
        ratio: Math.round(value * 10_000) / 10_000,
      },
    });
  }

  for (const warning of input.compileMeta.warnings) {
    findings.push({ code: warning.code, severity: 'warning', params: warning.params });
  }

  return { blocking: findings.some((finding) => finding.severity === 'error'), findings };
}

/**
 * TVRDÁ BRÁNA. `preSendCheck` sám jen vydá seznam nálezů, a seznam se dá
 * ignorovat: kdo ho zavolá a nepodívá se na `blocking`, odešle rozbitou
 * kampaň a nic nespadne. Odesílací cesta proto nevolá `preSendCheck`, ale
 * tuhle funkci: buď projde, nebo vyhodí, třetí možnost není.
 *
 * Vyhozená chyba nese celý výsledek, aby API mohlo vrátit `findings`
 * i u zamítnutého odeslání. Uživatel potřebuje vědět, co opravit, ne jen
 * že to nešlo.
 */
export class PreSendBlockedError extends Error {
  readonly code = 'precheck_blocked';
  readonly result: PreSendResult;

  constructor(result: PreSendResult) {
    const codes = result.findings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => finding.code)
      .join(', ');
    super(`precheck_blocked: ${codes}`);
    this.name = 'PreSendBlockedError';
    this.result = result;
  }

  /** Jen blokující nálezy, tedy to, co uživatel musí opravit. */
  get blockers(): PreSendFinding[] {
    return this.result.findings.filter((finding) => finding.severity === 'error');
  }
}

/**
 * Jediný povolený vstup odesílací cesty. Vrací nálezy JEN tehdy, když
 * odeslání smí proběhnout; u blokujícího nálezu vyhodí `PreSendBlockedError`.
 */
export function assertSendable(input: PreSendInput): PreSendResult {
  const result = preSendCheck(input);
  if (result.blocking) throw new PreSendBlockedError(result);
  return result;
}
