import crypto from 'node:crypto';
import { canonicalize } from './jcs';

/**
 * Ověření podpisu u `identify`, viz plán P10 Task 28 a specifikace 3.6.3.
 *
 * ```
 * signature = base64url_nopad( HMAC-SHA256( klíč,
 *               utf8(external_id) || 0x0A || jcs(traits) ) )
 * ```
 *
 * Bez podpisu server odmítne payload s e-mailem nebo telefonem chybou
 * `tracking_identify_unsigned_pii`. Kód z prohlížeče vidí každý a kdokoli ho
 * může zavolat s libovolným e-mailem, takže bez tohohle pravidla by šlo unést
 * cizí kontakt.
 *
 * KLÍČEM JE OTISK SEKRETU, NE SEKRET SÁM, a je to vědomá odchylka od 3.6.3.
 * TOHLE JE PRVNÍ ZE TŘÍ MÍST, KDE JE POPSANÁ. Zbylá dvě jsou komentář
 * u `selectIdentifySigningSecrets` v `repo/identify.repo.ts`, kde server ty
 * bajty vybírá, a report k plánu P10.
 *
 * Specifikace píše „bajty privátního API klíče workspace", jenže `api_keys`
 * drží jen SHA-256 otisk sekretu a surová hodnota v produktu neexistuje.
 * Podpis ze surového sekretu proto server ověřit nemůže a doslovná
 * implementace by odmítla každý podpis. Podepisuje se tedy otiskem, což je
 * odvozený klíč plné délky a bezpečnost se tím nemění.
 *
 * Tahle funkce o původu bajtů schválně NIC NEVÍ: bere `secret: Buffer`. Díky
 * tomu platí testovací vektor z plánu beze změny (vektor podepisuje prostým
 * řetězcem) a odchylka žije na jednom místě, u volajícího.
 */

const LF = 0x0a;

/**
 * Traits, které se z prohlížeče nesmí nastavit bez serverového podpisu.
 * Porovnává se bez ohledu na velikost písmen, aby EMAIL neprošlo obchůzkou.
 */
export const PII_TRAIT_KEYS: readonly string[] = ['email', 'e_mail', 'phone', 'tel', 'telefon'];

export function hasPiiTraits(traits: Record<string, unknown>): boolean {
  const pii = new Set(PII_TRAIT_KEYS);
  return Object.keys(traits).some((key) => pii.has(key.toLowerCase()));
}

export type VerifySignatureInput = {
  externalId: string;
  traits: Record<string, unknown>;
  signature: string;
  secret: Buffer;
};

/**
 * Sestaví podepisovaný vstup. Oddělovač je JEDEN bajt 0x0A, nikdy `\r\n`,
 * a `external_id` vstupuje jako surové UTF-8, nekanonizuje se.
 */
export function identifySigningInput(externalId: string, traits: Record<string, unknown>): Buffer {
  const id = Buffer.from(externalId, 'utf8');
  if (id.includes(LF)) {
    throw new Error('external_id nesmí obsahovat bajt 0x0A, podpis by byl nejednoznačný');
  }
  return Buffer.concat([id, Buffer.from([LF]), Buffer.from(canonicalize(traits), 'utf8')]);
}

export function signIdentify(input: {
  externalId: string;
  traits: Record<string, unknown>;
  secret: Buffer;
}): string {
  return crypto
    .createHmac('sha256', input.secret)
    .update(identifySigningInput(input.externalId, input.traits))
    .digest('base64url');
}

export function verifyIdentifySignature(input: VerifySignatureInput): boolean {
  const expected = crypto
    .createHmac('sha256', input.secret)
    .update(identifySigningInput(input.externalId, input.traits))
    .digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(input.signature, 'base64url');
  } catch {
    return false;
  }
  // `timingSafeEqual` hodí výjimku při rozdílné délce, proto se délka
  // kontroluje předem. Délka podpisu není tajná, prozradit se nedá nic.
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}
