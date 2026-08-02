import type { NonEmptyApiKey } from './build-model';
import { toApiKey } from './build-model';
import type { ProviderId } from './providers';

/**
 * Seznam modelů od providera. Slouží dvěma věcem najednou:
 * `GET /ai/models` z něj plní živou nabídku a `POST /ai/credentials/{id}/test`
 * ho používá jako nejlevnější možnou zkoušku klíče. Ověřovat klíč generováním
 * textu by stálo peníze uživatele za nic.
 *
 * Adresy a hlavičky jsou dobový snímek veřejných API providerů, ne kontrakt.
 */

export type ProbeParams = {
  provider: ProviderId;
  apiKey: NonEmptyApiKey;
  baseUrl: string | null;
};

export type ProbeDeps = { fetchImpl: typeof fetch };

/** Chyba se stavem, kterou umí přečíst `mapProviderError`. */
export class ProviderCallError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  readonly responseHeaders: Record<string, string>;

  constructor(status: number, body: string, headers: Record<string, string>) {
    super(`provider responded ${status}`);
    this.name = 'ProviderCallError';
    this.statusCode = status;
    this.responseBody = body;
    this.responseHeaders = headers;
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

type Request = { url: string; headers: Record<string, string> };

function requestFor(params: ProbeParams): Request {
  const base = params.baseUrl === null || params.baseUrl === '' ? null : trimSlash(params.baseUrl);
  switch (params.provider) {
    case 'anthropic':
      return {
        url: `${base ?? 'https://api.anthropic.com/v1'}/models`,
        headers: { 'x-api-key': params.apiKey, 'anthropic-version': '2023-06-01' },
      };
    case 'openai':
      return {
        url: `${base ?? 'https://api.openai.com/v1'}/models`,
        headers: { Authorization: `Bearer ${params.apiKey}` },
      };
    case 'google':
      // Google bere klíč v hlavičce, ne v query. V adrese by skončil
      // v access logu proxy i v historii prohlížeče.
      return {
        url: `${base ?? 'https://generativelanguage.googleapis.com/v1beta'}/models`,
        headers: { 'x-goog-api-key': params.apiKey },
      };
    case 'openrouter':
      return {
        url: `${base ?? 'https://openrouter.ai/api/v1'}/models`,
        headers: { Authorization: `Bearer ${params.apiKey}` },
      };
    case 'openai_compatible': {
      if (base === null) {
        throw new Error('openai_compatible: base_url je povinná.');
      }
      return { url: `${base}/models`, headers: { Authorization: `Bearer ${params.apiKey}` } };
    }
  }
}

function idsFrom(payload: unknown): string[] {
  const root = payload as { data?: unknown; models?: unknown } | null;
  const list = Array.isArray(root?.data)
    ? root.data
    : Array.isArray(root?.models)
      ? root.models
      : [];
  return list
    .map((entry) => {
      const item = entry as { id?: unknown; name?: unknown } | null;
      if (typeof item?.id === 'string') return item.id;
      // Google vrací `models/gemini-...`; do nabídky patří holý identifikátor.
      if (typeof item?.name === 'string') return item.name.replace(/^models\//, '');
      return null;
    })
    .filter((id): id is string => id !== null && id.length > 0);
}

/**
 * Zavolá seznamový endpoint providera. Klíč se ověřuje jako první: bez něj se
 * nesmí odeslat nic (kritérium 7b), a to platí i pro tuhle nejlevnější cestu.
 */
export async function probeProviderModels(params: ProbeParams, deps: ProbeDeps): Promise<string[]> {
  const apiKey = toApiKey(params.apiKey);
  const request = requestFor({ ...params, apiKey });

  const response = await deps.fetchImpl(request.url, {
    method: 'GET',
    headers: { ...request.headers, Accept: 'application/json' },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    throw new ProviderCallError(response.status, body, headers);
  }

  // Provider bez seznamového endpointu (`openai_compatible`) odpověď se seznamem
  // mít může i nemusí. Když ji nemá, zkouška klíče stejně proběhla: server
  // odpověděl 2xx, takže se vrátí prázdný seznam a klíč je označený za platný.
  const payload = (await response.json().catch(() => null)) as unknown;
  return idsFrom(payload);
}
