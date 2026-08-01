import type { Finding } from './resolver';

export type DomainChecks = {
  spf: { ok: boolean | null; record: string | null; findings: Finding[]; checked_at: string };
  dkim: {
    ok: boolean | null;
    found: number;
    expected: number;
    findings: Finding[];
    checked_at: string;
  };
  dmarc: {
    ok: boolean | null;
    record: string | null;
    policy: 'none' | 'quarantine' | 'reject' | null;
    pct: number | null;
    findings: Finding[];
    checked_at: string;
  };
  mx: { ok: boolean | null; records: string[]; findings: Finding[]; checked_at: string };
};

/** Odstupnovana frekvence, aby uzivatel nemusel cekat u obrazovky. */
export function nextCheckAt(input: { ageMinutes: number; verified: boolean }): number {
  if (input.verified) return 24 * 3600;
  if (input.ageMinutes < 15) return 30;
  if (input.ageMinutes < 120) return 300;
  if (input.ageMinutes < 72 * 60) return 1800;
  return 6 * 3600;
}

/** Vysledek plati min(nejnizsi TTL z odpovedi, 900 s), nejmene 60 s. */
export function cacheTtlSeconds(ttls: number[]): number {
  const lowest = ttls.length ? Math.min(...ttls) : 900;
  return Math.max(60, Math.min(lowest, 900));
}

export async function runDomainChecks(input: {
  spf: () => Promise<Omit<DomainChecks['spf'], 'checked_at'>>;
  dkim: () => Promise<Omit<DomainChecks['dkim'], 'checked_at'>>;
  dmarc: () => Promise<Omit<DomainChecks['dmarc'], 'checked_at'>>;
  mx: () => Promise<Omit<DomainChecks['mx'], 'checked_at'>>;
  overallTimeoutMs: number;
}): Promise<DomainChecks> {
  const at = new Date().toISOString();
  const timeout = <T>(fallback: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), input.overallTimeoutMs));

  const [spf, dkim, dmarc, mx] = await Promise.all([
    Promise.race([
      input.spf(),
      timeout({
        ok: null,
        record: null,
        findings: [{ code: 'spf_unknown', severity: 'warning' as const }],
      }),
    ]),
    Promise.race([
      input.dkim(),
      timeout({
        ok: null,
        found: 0,
        expected: 3,
        findings: [{ code: 'dkim_unknown', severity: 'warning' as const }],
      }),
    ]),
    Promise.race([
      input.dmarc(),
      timeout({
        ok: null,
        record: null,
        policy: null,
        pct: null,
        findings: [{ code: 'dmarc_unknown', severity: 'warning' as const }],
      }),
    ]),
    Promise.race([input.mx(), timeout({ ok: null, records: [], findings: [] })]),
  ]);

  return {
    spf: { ...spf, checked_at: at },
    dkim: { ...dkim, checked_at: at },
    dmarc: { ...dmarc, checked_at: at },
    mx: { ...mx, checked_at: at },
  };
}
