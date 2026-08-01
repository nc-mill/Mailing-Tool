/**
 * Typ chybové obálky podle RFC 9457, ve tvaru, který popisuje kapitola 4.8
 * části 1. Definuje ho P06, protože `packages/sdk-node` zatím nemá vlastníka
 * a `apps/web/src/lib/api/problem.ts` (P04) obálku staví, ne čte. Viz R4.
 */

export type Severity = 'error' | 'warning';

export type Finding = {
  code: string;
  severity: Severity;
  message: string;
  path?: string;
  params?: Record<string, unknown>;
};

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  /** Jen u validation_failed, porušení schématu. Tvar je zmrazený. */
  errors?: Array<{ path: string; code: string; message: string }>;
  /** Doménové kontroly s víc nálezy naráz, viz 4.2 části 1. */
  findings?: Finding[];
  /** Strojově čitelné parametry chyby, viz 4.2 části 1. */
  params?: Record<string, unknown>;
  /** Sekundy. Smí ho nést každý kód s příznakem opakovatelnosti. */
  retry_after?: number;
};

const REQUIRED_STRING_FIELDS = [
  'type',
  'title',
  'detail',
  'instance',
  'code',
  'request_id',
] as const;

export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['status'] !== 'number') return false;
  return REQUIRED_STRING_FIELDS.every((field) => typeof candidate[field] === 'string');
}

/**
 * Kódy, které smí vzniknout na straně rozhraní, když se požadavek na vlastní
 * API vůbec neuskutečnil. Všechny tři jsou v registru P01, takže se nezavádí
 * nový kód a `request_id` se nikdy nevymýšlí. Viz R5.
 */
export type LocalProblemCode = 'service_unavailable' | 'dependency_timeout' | 'internal_error';

const LOCAL_PROBLEM_META: Record<LocalProblemCode, { status: number; title: string }> = {
  service_unavailable: { status: 503, title: 'Service unavailable' },
  dependency_timeout: { status: 504, title: 'Dependency timeout' },
  internal_error: { status: 500, title: 'Internal server error' },
};

export function localProblem(input: { code: LocalProblemCode; instance: string }): Problem {
  const meta = LOCAL_PROBLEM_META[input.code];
  return {
    type: `https://docs.mlain.dev/errors/${input.code}`,
    title: meta.title,
    status: meta.status,
    detail: '',
    instance: input.instance,
    code: input.code,
    request_id: '',
  };
}
