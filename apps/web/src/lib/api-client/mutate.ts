import 'server-only';
import { cookies } from 'next/headers';
import { getCsrfToken } from '@/lib/identity/current-user';
import { getApiBaseUrl } from './base-url';
import { buildRequestHeaders, buildUrl, networkResult, readResponse } from './fetch';
import { parseSetCookies } from './set-cookie';
import type { Result } from './result';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Propíše `Set-Cookie` z odpovědi API do odpovědi, kterou Next.js pošle
 * prohlížeči.
 *
 * Bez tohohle kroku je přihlášení tichá lež: API relaci založí a vrátí cookie,
 * jenže odpověď API je odpověď na `fetch` uvnitř Server Action, ne odpověď pro
 * prohlížeč. Akce se pak tváří úspěšně, přesměruje, a uživatel přihlášený není.
 * Naměřeno v prohlížeči: po přihlášení zůstala jediná cookie `NEXT_LOCALE`.
 *
 * Platí to i opačně: odhlášení a změna hesla vracejí cookie s `Max-Age=0`,
 * takže se stejnou cestou relace v prohlížeči i ruší.
 */
async function forwardSetCookies(headers: Headers): Promise<void> {
  const incoming = parseSetCookies(headers);
  if (incoming.length === 0) return;

  // `cookies().set()` jde zavolat jen ze Server Action nebo Route Handleru.
  // Kdyby někdo zavolal `apiMutate` z Server Component, chyba se nesmí spolknout
  // potichu, protože přesně tak vypadá vada, kterou tenhle kód opravuje.
  const store = await cookies();
  for (const cookie of incoming) {
    store.set(cookie);
  }
}

export type MutateOptions = {
  /**
   * PUT je tu kvůli editačním formulářům. Rozdíl proti PATCH není kosmetický:
   * PATCH nechává vynechané pole být, PUT ho vymaže. Formulář, který posílá celý
   * stav obrazovky, potřebuje druhý význam, jinak by smazání hodnoty tiše neprošlo.
   */
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  workspaceId?: string;
  /** Povinný u endpointů z výčtu 4.4 části 1. Bere se ze skrytého pole formuláře. */
  idempotencyKey?: string;
  /** Re-autentizace heslem u předání vlastnictví, viz 3.3 části 1. */
  reauthPassword?: string;
  timeoutMs?: number;
};

/**
 * Zápis do vlastního API ze Server Action. Doplňuje obě vrstvy ochrany proti
 * CSRF podle 3.2 části 1: hlavičku Origin a double submit token.
 */
export async function apiMutate<T>(path: string, options: MutateOptions): Promise<Result<T>> {
  const url = buildUrl(path);
  const requestHeaders = await buildRequestHeaders(options.workspaceId);

  requestHeaders.set('origin', getApiBaseUrl());

  const csrfToken = await getCsrfToken();
  if (csrfToken) requestHeaders.set('x-csrf-token', csrfToken);
  if (options.idempotencyKey) requestHeaders.set('idempotency-key', options.idempotencyKey);
  if (options.reauthPassword) requestHeaders.set('x-reauth-password', options.reauthPassword);

  const hasBody = options.body !== undefined;
  if (hasBody) requestHeaders.set('content-type', 'application/json; charset=utf-8');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    // `exactOptionalPropertyTypes` nedovolí předat `body: undefined`, protože
    // `RequestInit.body` má typ `BodyInit | null`. Klíč se proto u požadavku
    // bez těla vůbec neuvede. Chování je stejné jako v plánu.
    const response = await fetch(url, {
      method: options.method,
      headers: requestHeaders,
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
      cache: 'no-store',
    });
    await forwardSetCookies(response.headers);
    return await readResponse<T>(response, path);
  } catch (cause) {
    return networkResult<T>(cause, path);
  } finally {
    clearTimeout(timer);
  }
}
