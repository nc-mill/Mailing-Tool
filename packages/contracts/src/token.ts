import { createHmac, timingSafeEqual } from 'node:crypto';
import { deriveKey, KEY_PURPOSES, type Keyring } from './keyring';

/**
 * Kontrakt 3: formát trackovacích tokenů (část 1, 4.10.3). ZMRAZENO.
 *
 *   token     = "t1" || base64url_nopad( type || key_id || payload || mac )
 *   mac       = prvních 16 bajtů z HMAC-SHA256
 *   mac_input = "mailer/token/v1" || type || key_id || payload
 *   mac_key   = HKDF(SHA-256, MASTER, "mailer/v1", "mailer/v1/tracking-token", 32)
 */
export const TOKEN_PREFIX = 't1';
export const TOKEN_MAC_INPUT_PREFIX = 'mailer/token/v1';
export const TOKEN_MAC_BYTES = 16;

export type TokenType = 'o' | 'c' | 'i' | 'u';

export type TokenErrorCode =
  | 'token_malformed'
  | 'token_signature_invalid'
  | 'token_type_mismatch'
  | 'token_unknown_key'
  | 'token_expired'
  | 'token_already_used';

export class TokenError extends Error {
  constructor(
    readonly code: TokenErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'TokenError';
  }
}

type FieldSpec = { name: string; kind: 'uuid' | 'u32' | 'bytes8' };

/** Pořadí polí je ZÁVAZNÉ a je součástí MAC vstupu. */
const LAYOUTS: Readonly<Record<TokenType, readonly FieldSpec[]>> = Object.freeze({
  o: [
    { name: 'workspace_id', kind: 'uuid' },
    { name: 'message_id', kind: 'uuid' },
    { name: 'message_created_at', kind: 'u32' },
  ],
  c: [
    { name: 'workspace_id', kind: 'uuid' },
    { name: 'message_id', kind: 'uuid' },
    { name: 'link_id', kind: 'uuid' },
    { name: 'message_created_at', kind: 'u32' },
  ],
  i: [
    { name: 'workspace_id', kind: 'uuid' },
    { name: 'contact_id', kind: 'uuid' },
    { name: 'campaign_id', kind: 'uuid' },
    { name: 'nonce', kind: 'bytes8' },
    { name: 'expires_at', kind: 'u32' },
  ],
  u: [
    { name: 'workspace_id', kind: 'uuid' },
    { name: 'message_id', kind: 'uuid' },
    { name: 'contact_id', kind: 'uuid' },
    { name: 'list_id', kind: 'uuid' },
    { name: 'message_created_at', kind: 'u32' },
  ],
});

export const PAYLOAD_BYTES: Readonly<Record<TokenType, number>> = Object.freeze({
  o: 36,
  c: 52,
  i: 60,
  u: 68,
});

/** `list_id` samých nul znamená globální odhlášení, ne odhlášení ze seznamu. */
export const GLOBAL_LIST_ID = '00000000-0000-0000-0000-000000000000';

export type TokenFields = Record<string, string | number>;

function uuidToBytes(value: string): Uint8Array {
  const hex = value.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex))
    throw new TokenError('token_malformed', `neplatné UUID ${value}`);
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodePayload(type: TokenType, fields: TokenFields): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const spec of LAYOUTS[type]) {
    const value = fields[spec.name];
    if (value === undefined) throw new TokenError('token_malformed', `chybí pole ${spec.name}`);
    if (spec.kind === 'uuid') parts.push(uuidToBytes(String(value)));
    else if (spec.kind === 'bytes8') {
      const bytes = new Uint8Array(Buffer.from(String(value), 'hex'));
      if (bytes.length !== 8) throw new TokenError('token_malformed', 'nonce musí mít 8 bajtů');
      parts.push(bytes);
    } else {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(Number(value));
      parts.push(new Uint8Array(buffer));
    }
  }
  return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

function decodePayload(type: TokenType, payload: Uint8Array): TokenFields {
  const fields: TokenFields = {};
  let offset = 0;
  for (const spec of LAYOUTS[type]) {
    if (spec.kind === 'uuid') {
      fields[spec.name] = bytesToUuid(payload.subarray(offset, offset + 16));
      offset += 16;
    } else if (spec.kind === 'bytes8') {
      fields[spec.name] = Buffer.from(payload.subarray(offset, offset + 8)).toString('hex');
      offset += 8;
    } else {
      fields[spec.name] = Buffer.from(payload.subarray(offset, offset + 4)).readUInt32BE();
      offset += 4;
    }
  }
  return fields;
}

function macFor(keyring: Keyring, keyId: number, type: TokenType, payload: Uint8Array): Buffer {
  const master = keyring.get(keyId);
  if (!master) throw new TokenError('token_unknown_key', `key_id ${keyId} není v konfiguraci`);
  const key = deriveKey(master, KEY_PURPOSES.trackingToken);
  return createHmac('sha256', key)
    .update(Buffer.from(TOKEN_MAC_INPUT_PREFIX, 'ascii'))
    .update(Buffer.from(type, 'ascii'))
    .update(Buffer.from([keyId]))
    .update(Buffer.from(payload))
    .digest();
}

export function buildToken(input: {
  type: TokenType;
  keyId: number;
  fields: TokenFields;
  keyring: Keyring;
}): { token: string; macFull: Uint8Array } {
  const payload = encodePayload(input.type, input.fields);
  if (payload.length !== PAYLOAD_BYTES[input.type]) {
    throw new TokenError(
      'token_malformed',
      `payload typu ${input.type} má mít ${PAYLOAD_BYTES[input.type]} B`,
    );
  }
  const macFull = macFor(input.keyring, input.keyId, input.type, payload);
  const raw = Buffer.concat([
    Buffer.from(input.type, 'ascii'),
    Buffer.from([input.keyId]),
    Buffer.from(payload),
    macFull.subarray(0, TOKEN_MAC_BYTES),
  ]);
  return { token: TOKEN_PREFIX + raw.toString('base64url'), macFull: new Uint8Array(macFull) };
}

/**
 * Ověření v NORMATIVNÍM pořadí kroků. Krok 4 (shoda typu s endpointem) se
 * nesmí vynechat: bez něj jde token pro otevření podstrčit jako token pro odhlášení.
 */
export function verifyToken(input: {
  token: string;
  endpointType: TokenType;
  keyring: Keyring;
  now: number;
  isNonceUsed: (nonceHex: string) => boolean;
}): { type: TokenType; keyId: number; fields: TokenFields } {
  // 1
  if (!input.token.startsWith(TOKEN_PREFIX))
    throw new TokenError('token_malformed', 'chybí prefix t1');
  const body = input.token.slice(TOKEN_PREFIX.length);
  // 2, base64url bez paddingu; standardní abeceda i padding jsou chyba
  if (!/^[A-Za-z0-9\-_]+$/.test(body))
    throw new TokenError('token_malformed', 'není base64url bez paddingu');
  const decoded = Buffer.from(body, 'base64url');
  const raw = new Uint8Array(decoded);
  if (decoded.toString('base64url') !== body) {
    throw new TokenError('token_malformed', 'zbytkové bity base64url nesedí');
  }
  if (raw.length < 2 + TOKEN_MAC_BYTES)
    throw new TokenError('token_malformed', 'token je příliš krátký');

  // Čte se přes readUInt8, aby typ byl `number`; indexy 0 a 1 jsou po kontrole délky vždy přítomné.
  const type = String.fromCharCode(decoded.readUInt8(0)) as TokenType;
  const keyId = decoded.readUInt8(1);
  if (!(type in LAYOUTS)) throw new TokenError('token_malformed', `neznámý typ ${type}`);
  // 3
  const expectedLength = 2 + PAYLOAD_BYTES[type] + TOKEN_MAC_BYTES;
  if (raw.length !== expectedLength)
    throw new TokenError('token_malformed', 'délka neodpovídá typu');
  // 4
  if (type !== input.endpointType) {
    throw new TokenError('token_type_mismatch', `typ ${type} na endpointu ${input.endpointType}`);
  }
  // 5
  if (!input.keyring.has(keyId)) throw new TokenError('token_unknown_key', `key_id ${keyId}`);

  const payload = raw.subarray(2, 2 + PAYLOAD_BYTES[type]);
  const mac = Buffer.from(raw.subarray(2 + PAYLOAD_BYTES[type]));
  // 6, porovnání v konstantním čase
  const expected = macFor(input.keyring, keyId, type, payload).subarray(0, TOKEN_MAC_BYTES);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    throw new TokenError('token_signature_invalid');
  }
  // 7, teprve teď se hodnoty z payloadu použijí
  const fields = decodePayload(type, payload);
  // 8
  if (type === 'i') {
    if (Number(fields.expires_at) <= input.now) throw new TokenError('token_expired');
    if (input.isNonceUsed(String(fields.nonce))) throw new TokenError('token_already_used');
  }
  return { type, keyId, fields };
}
