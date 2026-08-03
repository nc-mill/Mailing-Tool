import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Délku i abecedu vynucuje `ck_assets__public_id`: `^[0-9A-Za-z]{22}$`. */
export const PUBLIC_ID_LENGTH = 22;

/** Tvar identifikátoru z veřejné adresy. Kontroluje se DŘÍV, než se sáhne do databáze. */
export const PUBLIC_ID_PATTERN = /^[0-9A-Za-z]{22}$/;

/**
 * Veřejný identifikátor assetu: 22 znaků base62, tedy zhruba 130 bitů entropie.
 *
 * NA TÉHLE HODNOTĚ STOJÍ CELÁ BEZPEČNOST VEŘEJNÉ ADRESY. Rozhodnutí ze
 * specifikace 3.14.4 zní, že adresa obrázku NENÍ podepsaná ani časově omezená,
 * protože e-mail leží v cizí schránce roky, obrázek si vyžádá poštovní klient
 * příjemce (ne přihlášený uživatel) a Gmail obrázky proxuje a cachuje.
 * Jakákoli expirace by to rozbila přesně u klientů, na kterých nejvíc záleží.
 * Ochranou je tedy NEUHODNUTELNOST a nic jiného.
 *
 * Proto `randomBytes`, nikdy `Math.random`, a proto se hodnota NEODVOZUJE
 * z ničeho, co jde uhodnout: ne z id řádku (uuidv7 nese čas vzniku), ne
 * z hashe obsahu (kdo má tentýž obrázek, umí si spočítat adresu cizí kopie)
 * a ne z pořadí nahrání.
 *
 * MODULO BIAS SE ŘEŠÍ ODMÍTNUTÍM, ne zbytkem po dělení. 256 není dělitelné 62,
 * takže `byte % 62` by dávalo prvních osm znaků abecedy častěji než ostatní.
 * Ztráta entropie by byla malá, ale je zadarmo se jí vyhnout: bajty nad
 * poslední celý násobek se zahodí a losuje se dál.
 */
export function generatePublicId(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // 248
  let out = '';
  while (out.length < PUBLIC_ID_LENGTH) {
    for (const byte of randomBytes(PUBLIC_ID_LENGTH)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === PUBLIC_ID_LENGTH) break;
    }
  }
  return out;
}
