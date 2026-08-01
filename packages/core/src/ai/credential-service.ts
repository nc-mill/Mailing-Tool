import { createHash } from 'node:crypto';
import {
  decryptEnvelope as decryptEnvelopeImpl,
  encryptEnvelope as encryptEnvelopeImpl,
} from '@mlain/contracts/crypto';
import { ApiError } from '../errors/api-error';
import { toApiKey, type NonEmptyApiKey } from './build-model';
import type { ProviderId } from './providers';

/** Kontext obálky podle kontraktu 4.10.4. Nikdy se neodvozuje z proměnné. */
export const AI_CREDENTIAL_CONTEXT = 'ai_provider' as const;

export type CredentialRow = {
  id: string;
  provider: ProviderId;
  label: string;
  keyHint: string;
  keyFingerprint: string;
  baseUrl: string | null;
  defaultModel: string;
  defaultCredential: boolean;
  lastUsedAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicCredential = {
  id: string;
  provider: ProviderId;
  label: string;
  key_hint: string;
  base_url: string | null;
  default_model: string;
  default_credential: boolean;
  last_used_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

/** Otisk slouží jen k tomu, aby UI poznalo "tenhle klíč už tu máte pod jiným jménem". */
export function fingerprintApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 16);
}

/** Poslední čtyři znaky. U kratšího klíče se nezobrazí nic, jen výplň. */
export function hintFromApiKey(apiKey: string): string {
  return apiKey.length >= 4 ? apiKey.slice(-4) : '•'.repeat(apiKey.length);
}

/**
 * Veřejný tvar. Klíč se nikdy nevrací přes API, otisk taky ne: otisk je
 * detekce duplicit na naší straně, ne informace pro klienta.
 */
export function toPublicCredential(row: CredentialRow): PublicCredential {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    key_hint: row.keyHint,
    base_url: row.baseUrl,
    default_model: row.defaultModel,
    default_credential: row.defaultCredential,
    last_used_at: row.lastUsedAt,
    last_error_at: row.lastErrorAt,
    last_error_code: row.lastErrorCode,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

type EncryptDeps = { encryptEnvelope?: typeof encryptEnvelopeImpl };
type DecryptDeps = { decryptEnvelope?: typeof decryptEnvelopeImpl };

/**
 * Vrací `string`, protože do sloupce `ai_provider_credentials.api_key_encrypted`
 * (typ `text`, viz P03) patří obálka `enc:v1:<base64>`, ne binární data.
 *
 * `encryptEnvelope` vrací objekt; sáhne se na jeho pole `stored`. Kdyby se
 * uložil celý objekt, skončil by v databázi řetězec `[object Object]` a
 * chyba by se projevila až při prvním pokusu o dešifrování.
 */
export function encryptApiKey(
  params: { workspaceId: string; apiKey: string },
  deps: EncryptDeps = {},
): string {
  const encrypt = deps.encryptEnvelope ?? encryptEnvelopeImpl;
  const envelope = encrypt({
    context: AI_CREDENTIAL_CONTEXT,
    workspaceId: params.workspaceId,
    plaintext: JSON.stringify({ apiKey: params.apiKey }),
  });
  return envelope.stored;
}

export function decryptApiKey(
  params: { workspaceId: string; stored: string },
  deps: DecryptDeps = {},
): NonEmptyApiKey {
  const decrypt = deps.decryptEnvelope ?? decryptEnvelopeImpl;
  const plaintext = decrypt({
    context: AI_CREDENTIAL_CONTEXT,
    workspaceId: params.workspaceId,
    stored: params.stored,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    throw new ApiError('ai_credential_missing');
  }
  const apiKey = (parsed as { apiKey?: unknown } | null)?.apiKey;
  return toApiKey(apiKey);
}
