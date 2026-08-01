import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { currentKeyId, deriveKey, KEY_PURPOSES, keyringFromEnv, type Keyring } from './keyring';

/**
 * Kontrakt 4: šifrování credentials (část 1, 4.10.4). ZMRAZENO.
 *
 *   header   = version(1) || key_id(1) || context_len(1) || context(context_len)
 *   envelope = header || nonce(12) || ciphertext(N) || tag(16)
 *   stored   = "enc:v1:" || base64_standard_with_padding(envelope)
 *   aad      = "mailer/cred/v1" || header || workspace_id(16)
 *   key      = HKDF(SHA-256, MASTER, "mailer/v1", "mailer/v1/credential-encryption", 32)
 *
 * Base64 je zde STANDARDNÍ s paddingem, na rozdíl od tokenů, kde je base64url
 * bez paddingu. Rozdíl je záměrný: token jde do URL, tohle ne.
 */
export const ENVELOPE_PREFIX = 'enc:v1:';
export const ENVELOPE_VERSION = 0x01;
export const AAD_PREFIX = 'mailer/cred/v1';
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

export const CREDENTIAL_CONTEXTS = [
  'sending_provider',
  'ai_provider',
  'webhook_secret',
  'oauth_token',
] as const;
export type CredentialContext = (typeof CREDENTIAL_CONTEXTS)[number];

export type CryptoErrorCode =
  | 'crypto_envelope_malformed'
  | 'crypto_unsupported_version'
  | 'crypto_context_mismatch'
  | 'crypto_unknown_key'
  | 'crypto_auth_failed';

export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CryptoError';
  }
}

function workspaceIdBytes(workspaceId: string): Buffer {
  const hex = workspaceId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new CryptoError('crypto_envelope_malformed', `neplatné workspace_id ${workspaceId}`);
  }
  return Buffer.from(hex, 'hex');
}

function buildHeader(keyId: number, context: CredentialContext): Buffer {
  const contextBytes = Buffer.from(context, 'ascii');
  if (contextBytes.length < 1 || contextBytes.length > 64) {
    throw new CryptoError('crypto_envelope_malformed', 'context musí mít 1 až 64 bajtů');
  }
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION, keyId, contextBytes.length]), contextBytes]);
}

function buildAad(header: Buffer, workspaceId: string): Buffer {
  return Buffer.concat([Buffer.from(AAD_PREFIX, 'ascii'), header, workspaceIdBytes(workspaceId)]);
}

export type EncryptInput = {
  plaintext: string;
  context: CredentialContext;
  workspaceId: string;
  /** když chybí, načte se z prostředí, aby volání odpovídalo tomu, co používá P04 */
  keyring?: Keyring;
  keyId?: number;
  /** jen pro golden fixtures; v provozu se generuje z CSPRNG a NIKDY se neopakuje */
  nonce?: Uint8Array;
};

export function encryptEnvelope(input: EncryptInput): {
  stored: string;
  header: Uint8Array;
  aad: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
  envelopeBytes: number;
  /** key_id, kterým se obálka opravdu zašifrovala; potřebuje ho report rotace v P16 */
  envelopeKeyId: number;
} {
  const keyring = input.keyring ?? keyringFromEnv();
  const keyId = input.keyId ?? currentKeyId(keyring);
  const master = keyring.get(keyId);
  if (!master) throw new CryptoError('crypto_unknown_key', `key_id ${keyId}`);

  const header = buildHeader(keyId, input.context);
  const aad = buildAad(header, input.workspaceId);
  const nonce = Buffer.from(input.nonce ?? randomBytes(NONCE_BYTES));
  if (nonce.length !== NONCE_BYTES)
    throw new CryptoError('crypto_envelope_malformed', 'nonce musí mít 12 bajtů');

  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(deriveKey(master, KEY_PURPOSES.credentialEncryption)),
    nonce,
  );
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(input.plaintext, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([header, nonce, ciphertext, tag]);

  return {
    stored: ENVELOPE_PREFIX + envelope.toString('base64'),
    header: new Uint8Array(header),
    aad: new Uint8Array(aad),
    ciphertext: new Uint8Array(ciphertext),
    tag: new Uint8Array(tag),
    envelopeBytes: envelope.length,
    envelopeKeyId: keyId,
  };
}

/**
 * Přečte `key_id` z hlavičky obálky, aniž by ji dešifroval a aniž by potřeboval
 * klíč. Slouží reportu rotace: dá se jím projít sloupec se zašifrovanými
 * hodnotami a zjistit, kolik jich ještě visí na starém pokolení klíče.
 * Jméno a signatura jsou dané tím, jak funkci volá P16 (rozhodnutí R6).
 */
export function envelopeKeyId(stored: string): number {
  if (!stored.startsWith(ENVELOPE_PREFIX)) {
    throw new CryptoError('crypto_envelope_malformed', 'chybí prefix enc:v1:');
  }
  const envelope = Buffer.from(stored.slice(ENVELOPE_PREFIX.length), 'base64');
  if (envelope.length < 3)
    throw new CryptoError('crypto_envelope_malformed', 'obálka je příliš krátká');
  if (envelope[0] !== ENVELOPE_VERSION) {
    throw new CryptoError('crypto_unsupported_version', `version ${envelope[0]}`);
  }
  return envelope.readUInt8(1);
}

export type DecryptInput = {
  stored: string;
  context: CredentialContext;
  workspaceId: string;
  keyring?: Keyring;
};

/** Dešifrování v NORMATIVNÍM pořadí kroků z 4.10.4. */
export function decryptEnvelope(input: DecryptInput): string {
  const keyring = input.keyring ?? keyringFromEnv();
  // 1
  if (!input.stored.startsWith(ENVELOPE_PREFIX)) {
    throw new CryptoError('crypto_envelope_malformed', 'chybí prefix enc:v1:');
  }
  const encoded = input.stored.slice(ENVELOPE_PREFIX.length);
  // 2
  let envelope: Buffer;
  try {
    envelope = Buffer.from(encoded, 'base64');
    if (envelope.toString('base64') !== encoded) throw new Error('nekanonické base64');
  } catch {
    throw new CryptoError('crypto_envelope_malformed', 'base64 dekódování selhalo');
  }
  if (envelope.length < 3)
    throw new CryptoError('crypto_envelope_malformed', 'obálka je příliš krátká');
  // 3
  if (envelope[0] !== ENVELOPE_VERSION) {
    throw new CryptoError('crypto_unsupported_version', `version ${envelope[0]}`);
  }
  // 4
  // Přes readUInt8, aby typ byl `number`; oba indexy jsou po kontrole délky vždy přítomné.
  const keyId = envelope.readUInt8(1);
  const contextLen = envelope.readUInt8(2);
  if (contextLen < 1 || contextLen > 64)
    throw new CryptoError('crypto_envelope_malformed', 'context_len mimo 1..64');
  const headerLength = 3 + contextLen;
  if (envelope.length < headerLength + NONCE_BYTES + TAG_BYTES) {
    throw new CryptoError(
      'crypto_envelope_malformed',
      'obálka je kratší než hlavička, nonce a tag',
    );
  }
  const header = envelope.subarray(0, headerLength);
  const context = header.subarray(3).toString('ascii');
  // 5
  if (context !== input.context) {
    throw new CryptoError(
      'crypto_context_mismatch',
      `obálka nese ${context}, čekal se ${input.context}`,
    );
  }
  // 6
  const master = keyring.get(keyId);
  if (!master) throw new CryptoError('crypto_unknown_key', `key_id ${keyId}`);
  // 7
  const nonce = envelope.subarray(headerLength, headerLength + NONCE_BYTES);
  const tag = envelope.subarray(envelope.length - TAG_BYTES);
  const ciphertext = envelope.subarray(headerLength + NONCE_BYTES, envelope.length - TAG_BYTES);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(deriveKey(master, KEY_PURPOSES.credentialEncryption)),
    nonce,
  );
  decipher.setAAD(buildAad(Buffer.from(header), input.workspaceId));
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Chybu NIKDY nerozlišuj podle příčiny směrem ven; ven jde vždy jeden kód.
    throw new CryptoError('crypto_auth_failed');
  }
  // 8, parsování JSON dělá volající
  return plaintext.toString('utf8');
}
