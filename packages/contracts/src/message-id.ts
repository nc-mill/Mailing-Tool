/**
 * Deterministický Message-ID (KONTRAKT, část 1, 4.10.1):
 *
 *   Message-ID: <ml.{base32_lower(uuid_bytes(messages.id))}@{sending_domain}>
 *
 * Nikdy nezahrnuje číslo pokusu ani čas, takže opakované odeslání téže zprávy
 * má identický Message-ID a většina přijímajících MTA ho deduplikuje.
 *
 * POZOR: na Amazon SES tahle pojistka NEEXISTUJE, protože SES si Message-ID
 * generuje sám a dodanou hlavičku přepíše. Je to zmírnění platné jen pro SMTP
 * a proto má SES výchozí politiku `fail` u nejednoznačného odeslání.
 *
 * ROZHODNUTÍ D6 tohoto plánu: `base32_lower` je RFC 4648 standardní abeceda,
 * bez paddingu, převedená na malá písmena. Kontrakt kódování neurčuje (nález
 * K13 části 4b), bez volby nejde OB-11 napsat.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.toLowerCase();
}

export function buildMessageId(input: { messageId: string; sendingDomain: string }): string {
  const hex = input.messageId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`neplatné UUID zprávy: ${input.messageId}`);
  return `<ml.${base32Lower(new Uint8Array(Buffer.from(hex, 'hex')))}@${input.sendingDomain}>`;
}
