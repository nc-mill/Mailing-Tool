import 'server-only';
import { cookies, headers } from 'next/headers';
import { getApiBaseUrl } from './base-url';
import { isProblem, localProblem, type LocalProblemCode } from './problem';
import { err, ok, type Result } from './result';

export const SESSION_COOKIE = 'ml_session';
const DEFAULT_TIMEOUT_MS = 10_000;

export type QueryValue = string | number | undefined;

export type ApiFetchOptions = {
  /** Posílá se jako X-Workspace-Id. Bez něj běží požadavek mimo kontext projektu. */
  workspaceId?: string;
  searchParams?: Record<string, QueryValue>;
  timeoutMs?: number;
};

export function buildUrl(path: string, searchParams: Record<string, QueryValue> = {}): string {
  const url = new URL(path, `${getApiBaseUrl()}/`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function buildRequestHeaders(workspaceId?: string): Promise<Headers> {
  const outgoing = new Headers({ accept: 'application/json' });

  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (session) outgoing.set('cookie', `${SESSION_COOKIE}=${session.value}`);

  const incoming = await headers();
  const acceptLanguage = incoming.get('accept-language');
  if (acceptLanguage) outgoing.set('accept-language', acceptLanguage);

  /*
   * USER AGENT PROHLÍŽEČE, NE NAŠEHO SERVERU.
   *
   * Požadavek na API vzniká uvnitř Server Action, takže ho odesílá `fetch`
   * v Node a ten se představuje jako `node`. API čte `User-Agent` z požadavku,
   * který dostane, a přesně tohle si ukládalo k relaci: v tabulce `sessions`
   * leželo u 262 přihlášení `node` a obrazovka „Aktivní relace" u každého psala
   * „Neznámé zařízení". Tím ztratila jediný smysl, který má, tedy poznat cizí
   * přihlášení. Totéž platí pro auditní záznamy o přihlášení a odhlášení.
   *
   * Přeposílá se stejně jako `accept-language` výš: je to údaj o TOM, KDO SEDÍ
   * U PROHLÍŽEČE, a od nás k němu nemá co přibývat ani ubývat.
   */
  const userAgent = incoming.get('user-agent');
  if (userAgent) outgoing.set('user-agent', userAgent);

  if (workspaceId) outgoing.set('x-workspace-id', workspaceId);
  return outgoing;
}

function statusToLocalCode(status: number): LocalProblemCode {
  if (status === 503) return 'service_unavailable';
  if (status === 504) return 'dependency_timeout';
  return 'internal_error';
}

export async function readResponse<T>(response: Response, instance: string): Promise<Result<T>> {
  if (response.status === 204) return ok(undefined as T);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/problem+json')) {
    const parsed: unknown = await response.json().catch(() => null);
    if (isProblem(parsed)) return err(parsed);
    return err(localProblem({ code: statusToLocalCode(response.status), instance }));
  }

  if (!response.ok) {
    return err(localProblem({ code: statusToLocalCode(response.status), instance }));
  }

  const parsed: unknown = await response.json().catch(() => null);
  return ok(parsed as T);
}

export function networkResult<T>(cause: unknown, instance: string): Result<T> {
  const aborted =
    cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError');
  return err(
    localProblem({ code: aborted ? 'dependency_timeout' : 'service_unavailable', instance }),
  );
}

/**
 * Čtení z vlastního API. Nikdy nevyhazuje výjimku: obrazovka dostane buď data,
 * nebo Problem, ze kterého umí vykreslit stav S9 včetně request_id.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<Result<T>> {
  const url = buildUrl(path, options.searchParams);
  const requestHeaders = await buildRequestHeaders(options.workspaceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      signal: controller.signal,
      cache: 'no-store',
    });
    return await readResponse<T>(response, path);
  } catch (cause) {
    return networkResult<T>(cause, path);
  } finally {
    clearTimeout(timer);
  }
}
