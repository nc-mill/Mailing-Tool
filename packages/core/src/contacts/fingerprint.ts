import { createHmac } from 'node:crypto';
import { KEY_PURPOSES, currentKeyId, deriveKey, type Keyring } from '@mlain/contracts/keyring';

/**
 * Purpose ani odvození klíče si tenhle modul NEDEFINUJE. Obojí vlastní kontrakt P02
 * (`@mlain/contracts/keyring`) a tenhle modul ho jen používá.
 *
 * Dřívější znění plánu si tady drželo vlastní konstantu purpose, vlastní HKDF sůl
 * a vlastní typ `Keyring` s tvarem `{ current, all }`, zatímco kontrakt má
 * `Map<number, Uint8Array>`. Byly by to dvě implementace téhož receptu a rozdíl mezi
 * nimi se nepozná ničím jiným než tím, že vymazaný člověk dostane mail: otisk smazané
 * adresy nejde přepočítat, protože plaintext je po výmazu podle článku 17 pryč.
 *
 * Řetězec purpose je ZMRAZENÝ NAVŽDY a nesmí se změnit ani při přejmenování produktu,
 * proto v něm jméno produktu záměrně není. Hlídá to test.
 */
function fingerprintWith(master: Uint8Array, email: string): Buffer {
  const derived = deriveKey(master, KEY_PURPOSES.suppressionFingerprint);
  return createHmac('sha256', derived).update(email.toLowerCase(), 'utf8').digest();
}

/**
 * Otisk pod aktuálním pokolením klíče. Používá se při ZÁPISU nového suppression řádku
 * a nového záznamu v gdpr_requests. Ukládá se spolu s fingerprint_key_id, aby se dal
 * později ověřit svým pokolením.
 */
export function computeCurrentFingerprint(
  keyring: Keyring,
  email: string,
): { fingerprint: Buffer; keyId: number } {
  const keyId = currentKeyId(keyring);
  const master = keyring.get(keyId);
  if (master === undefined) throw new Error(`keyring nezná pokolení ${keyId}`);
  return { fingerprint: fingerprintWith(master, email), keyId };
}

/**
 * Otisky pro VŠECHNA známá pokolení klíče, bez horního stropu.
 *
 * Používá se při KONTROLE (dotaz `fingerprint = ANY($1)`) a při zápisu kontaktu, jehož
 * sloupec email_fingerprints nese otisk pod každým pokolením. U kontaktu to jde, protože
 * plaintext adresy máme; u suppression řádku po výmazu už ne, a v tom je celý problém.
 *
 * Strop na počet pokolení NEEXISTUJE a nesmí se zavést ani jako validace SECRET_KEY_PREVIOUS.
 * Otisk starého suppression záznamu nelze nikdy přepočítat, protože adresa byla vymazána
 * podle článku 17. Po překročení stropu by se nejstarší záznamy přestaly dát ověřit a smazaný
 * člověk by se vrátil prvním dalším importem, aniž by cokoliv selhalo nebo se zalogovalo.
 * Je to nejtišší možná porucha: žádná chyba, žádný záznam v logu, jen zmizelá ochrana.
 *
 * Cena je jeden HMAC na pokolení a adresu, tedy řádově mikrosekunda. Při deseti pokoleních
 * a importu sta tisíc kontaktů je to zhruba sekunda navíc. Přirozeným stropem je počet
 * rotací za životnost instalace, což jsou jednotky za roky.
 */
export function computeAllFingerprints(keyring: Keyring, email: string): Buffer[] {
  if (keyring.size === 0) {
    throw new Error(
      'keyring je prázdný: bez znalosti pokolení klíče nejde ověřit suppression list, ' +
        'protože otisky vymazaných adres se nedají přepočítat',
    );
  }
  return [...keyring.values()].map((master) => fingerprintWith(master, email));
}

/**
 * Dávková varianta pro kontrolu více adres naráz. Vrací zploštělé pole otisků, tedy
 * počet adres krát počet pokolení. Pro dávku 1 000 adres a tři pokolení má 3 000 položek.
 *
 * Jsou to tytéž hodnoty, které se ukládají do contacts.email_fingerprints, takže se
 * při importu nepočítají dvakrát.
 */
export function computeAllFingerprintsBatch(keyring: Keyring, emails: readonly string[]): Buffer[] {
  const result: Buffer[] = [];
  for (const email of emails) result.push(...computeAllFingerprints(keyring, email));
  return result;
}
