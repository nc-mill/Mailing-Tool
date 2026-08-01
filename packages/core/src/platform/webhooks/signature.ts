import { createHmac, randomBytes } from 'node:crypto';

const SECRET_PREFIX = 'whsec_';

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function secretToBytes(secret: string): Buffer {
  return Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64url');
}

/**
 * 3.8:
 *   signed_payload = "<unix_timestamp>" + "." + <syrové tělo requestu>
 *   v1             = hex(HMAC-SHA256(secret_bytes, signed_payload))
 *
 * Timestamp je součástí podepisovaných dat, takže ho útočník nemůže změnit.
 * Ochrana proti replay se odehrává u příjemce: v dokumentaci je závazný pokyn
 * odmítnout požadavek starší než 5 minut a deduplikovat podle ML-Event-Id.
 */
export function signPayload(secret: string, unixTimestamp: number, body: string): string {
  return createHmac('sha256', secretToBytes(secret))
    .update(`${unixTimestamp}.${body}`, 'utf8')
    .digest('hex');
}

/**
 * Tvar t=...,v1=... je zvolený proto, že jde přidat v2= vedle v1= a rotovat
 * algoritmus bez rozbití příjemců, kteří umí jen v1.
 */
export function signatureHeader(secret: string, unixTimestamp: number, body: string): string {
  return `t=${unixTimestamp},v1=${signPayload(secret, unixTimestamp, body)}`;
}
