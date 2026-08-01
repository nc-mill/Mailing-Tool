import {
  KEY_PURPOSES,
  currentKeyId,
  deriveKey,
  parseKeyring,
  type Keyring,
} from '@mlain/contracts/keyring';

export type KeyringInput = { secretKey: string; secretKeyPrevious: string };

/**
 * key_id 1 až 255 na MASTER, přesně v tom tvaru, jaký žádají `buildToken`
 * a `verifyToken` z kontraktu. Odvození na K_tracking si dělá kodek sám,
 * takže se tady nikdy neukládá odvozený klíč: kdyby ano, kontrakt by ho
 * odvodil podruhé a podpis by tiše nesouhlasil.
 */
export type TrackingKeyring = Keyring;

/**
 * Rozklad `SECRET_KEY` a `SECRET_KEY_PREVIOUS` vlastní kontrakt. Patří k němu
 * implicitní `key_id 1`, tvar `<key_id>:<base64url>`, rozsah 1 až 255, kontrola
 * na 32 bajtů i to, že **horní strop na počet pokolení neexistuje**: bez starých
 * klíčů přestanou platit odkazy v e-mailech, které leží ve schránkách roky.
 */
export function buildTrackingKeyring(input: KeyringInput): TrackingKeyring {
  return parseKeyring({
    secretKey: input.secretKey,
    secretKeyPrevious: input.secretKeyPrevious,
  });
}

/**
 * Odvození zmrazené v 3.10 části 1. Provozní cesta ho nevolá, dělá ho kodek
 * uvnitř kontraktu. Zůstává tady jako jediná pojistka, že se `HKDF_SALT`
 * ani `KEY_PURPOSES.trackingToken` nezmění pod rukama: test proti němu drží
 * vektor z části 1, tedy zdroj nezávislý na kontraktu.
 */
export function deriveTrackingKey(master: Uint8Array): Uint8Array {
  return deriveKey(master, KEY_PURPOSES.trackingToken);
}

/**
 * Nejvyšší pokolení v keyringu, tedy to, kterým se PODEPISUJE. Ověřovat se
 * musí všemi, podepisovat jen tímhle. Propouští se z kontraktu dál, aby
 * `apps/web` nemuselo mít `@mlain/contracts` mezi přímými závislostmi.
 */
export function currentTrackingKeyId(keyring: TrackingKeyring): number {
  return currentKeyId(keyring);
}
