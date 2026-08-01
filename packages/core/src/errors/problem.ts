import { problemCode, typeUri } from './registry';

export interface ProblemFieldError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemFinding {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly path?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface BuildProblemInput {
  readonly code: string;
  readonly instance: string;
  readonly requestId: string;
  readonly detail?: string;
  readonly errors?: readonly ProblemFieldError[];
  readonly findings?: readonly ProblemFinding[];
  readonly params?: Readonly<Record<string, unknown>>;
  /** Přebije retryAfterSeconds z registru, například u rate limitu. */
  readonly retryAfterSeconds?: number;
}

/**
 * Sestaví tělo odpovědi podle RFC 9457 tak, jak ho definuje část 1, kapitola 4.2.
 * Content-Type application/problem+json nastavuje volající, tahle funkce vrací
 * jen tělo, aby ji šlo použít i mimo HTTP vrstvu.
 */
export function buildProblem(input: BuildProblemInput): Record<string, unknown> {
  const entry = problemCode(input.code);

  if (input.errors && input.code !== 'validation_failed') {
    throw new Error(
      'errors[] patří výhradně k validation_failed. Doménové nálezy patří do findings[].',
    );
  }
  if (input.findings && !input.findings.some((finding) => finding.severity === 'error')) {
    throw new Error(
      'Chybová odpověď s findings musí obsahovat aspoň jeden nález se severity "error". Samotná varování se vracejí s úspěšnou odpovědí.',
    );
  }

  const problem: Record<string, unknown> = {
    type: typeUri(entry.code),
    title: entry.title,
    status: entry.status,
    instance: input.instance,
    code: entry.code,
    request_id: input.requestId,
  };
  if (input.detail !== undefined) problem['detail'] = input.detail;
  if (input.errors !== undefined) problem['errors'] = input.errors;
  if (input.findings !== undefined) problem['findings'] = input.findings;
  if (input.params !== undefined) problem['params'] = input.params;

  const retryAfter = input.retryAfterSeconds ?? entry.retryAfterSeconds;
  if (entry.retryable && retryAfter !== undefined) problem['retry_after'] = retryAfter;

  // Pořadí klíčů je stabilní kvůli snapshotům a kvůli tomu, že detail je
  // uprostřed obálky v příkladu ve specifikaci.
  const ordered: Record<string, unknown> = {};
  for (const key of [
    'type',
    'title',
    'status',
    'detail',
    'instance',
    'code',
    'request_id',
    'errors',
    'findings',
    'params',
    'retry_after',
  ]) {
    if (key in problem) ordered[key] = problem[key];
  }
  return ordered;
}
