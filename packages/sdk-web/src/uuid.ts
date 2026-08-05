/**
 * anonymous_id je UUIDv4, ne UUIDv7. Vědomá výjimka z konvence:
 * ID je trvale viditelné v cookii na cizím počítači a UUIDv7 by v prvních
 * 48 bitech prozradilo přesný čas první návštěvy každému skriptu na stránce.
 * Zápisový argument pro UUIDv7 tady neplatí, není to primární klíč.
 */
export function uuidv4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += bytes[i]!.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
