import { Resolver } from 'node:dns/promises';

export type DnsResolver = {
  resolveTxt(host: string): Promise<string[][]>;
  resolveCname(host: string): Promise<string[]>;
  resolveMx(host: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolveNs(host: string): Promise<string[]>;
};

/**
 * Vestaveny resolver Node, bez dalsi zavislosti. Timeout na dotaz je DNS_CHECK_TIMEOUT_MS.
 *
 * Ochrana proti SSRF se tady VEDOME nepouziva a neni to opomenuti: kontroly domeny
 * se na jmena jen PTAJI DNS serveru, nikdy se na ne nepripojuji. Vektor SSRF je test
 * SMTP pripojeni, ktery adresu skutecne otevira, a tam ochrana je (`smtp/verify.ts`).
 */
export function createResolver(timeoutMs: number): DnsResolver {
  const r = new Resolver({ timeout: timeoutMs, tries: 1 });
  return {
    resolveTxt: (h) => r.resolveTxt(h),
    resolveCname: (h) => r.resolveCname(h),
    resolveMx: (h) => r.resolveMx(h),
    resolveNs: (h) => r.resolveNs(h),
  };
}

export type Finding = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  params?: Record<string, string | number>;
};

/** Rozlisuje se false (vime, ze to neni v poradku) a null (nevime). Null nesmi blokovat. */
export type CheckResult = { ok: boolean | null; findings: Finding[] };

export function unknownOnServfail(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return (
    code === 'SERVFAIL' || code === 'ETIMEOUT' || code === 'ECONNREFUSED' || code === 'EREFUSED'
  );
}
