import {
  currentKeyId,
  parseKeyring,
  secretKeyFingerprint,
  type Keyring,
} from '@mlain/contracts/keyring';

export type OpsKeyring = {
  currentKeyId: number;
  currentFingerprint: string;
  /** key_id -> otisk, pro každé známé pokolení. */
  fingerprints: ReadonlyMap<number, string>;
  /** Syrový keyring pro `encryptEnvelope` a `decryptEnvelope`. */
  keyring: Keyring;
};

export type KeyringEnv = { secretKey: string; secretKeyPrevious: string };

/**
 * Poskládá keyring z prostředí. Recept odvození i otisku vlastní kontrakt
 * (01-platforma 3.10). Tenhle modul doplňuje jen pohled, který potřebuje
 * `mlain doctor`: seznam pokolení, která instalace zná.
 *
 * DVĚ VĚCI, KTERÉ SE TU SNADNO POKAZÍ, obojí ověřeno proti kontraktu P02:
 *
 *  1. `parseKeyring` bere JEDEN OBJEKT, ne dva poziční argumenty, a vrací
 *     `Keyring = Map<number, Uint8Array>`, ne strukturu s poli `all` a `current`.
 *  2. `secretKeyFingerprint` bere MASTER a odvození `mailer/v1/secret-key-fingerprint`
 *     si dělá sama. Zavolat ji s už odvozeným klíčem se přeloží, nespadne
 *     a vrátí TIŠE JINÝ OTISK. Otisk by pak nesouhlasil s tím, co zapsal
 *     `POST /api/v1/setup`, a `mlain doctor` by hlásil kritickou neshodu klíče
 *     u instalace, které nic není. Vektor v prvním testu je jediná pojistka.
 *
 * Strop na počet pokolení tady není a nesmí se zavést. Otisk smazané adresy
 * nejde nikdy přepočítat, protože plaintext je po výmazu podle GDPR pryč.
 * Se stropem by se nejstarší záznamy přestaly dát ověřit a smazaný člověk
 * by se vrátil prvním dalším importem, aniž by cokoliv selhalo nebo se
 * zalogovalo. Je to nejtišší možná porucha.
 */
export function loadOpsKeyring(env: KeyringEnv): OpsKeyring {
  const keyring = parseKeyring({
    secretKey: env.secretKey,
    secretKeyPrevious: env.secretKeyPrevious,
  });
  const fingerprints = new Map<number, string>();
  for (const [keyId, master] of keyring) {
    fingerprints.set(keyId, secretKeyFingerprint(master));
  }
  const current = currentKeyId(keyring);
  return {
    currentKeyId: current,
    currentFingerprint: fingerprints.get(current)!,
    fingerprints,
    keyring,
  };
}

/**
 * Převede klíče z `loadConfig()` zpátky na tvar, kterému rozumí kontrakt P02.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ KONFIGURACÍ P01. Plán všude předával
 * `config.SECRET_KEY` a `config.SECRET_KEY_PREVIOUS` rovnou do
 * `loadOpsKeyring`, jenže zod schéma P01 je **nevrací jako řetězce**:
 * `SECRET_KEY` je `{ keyId, key, raw }` a `SECRET_KEY_PREVIOUS` je pole
 * takových objektů. Ověřeno spuštěním: bez tohohle převodu spadnou všechny
 * čtyři kontroly keyringu v `mlain doctor` na `value.trim is not a function`
 * a vypíšou se jako čtyři nicneříkající `check_failed`. Diagnostika, která
 * nejtišší poruchu produktu ohlásí jako „kontrolu se nepodařilo dokončit",
 * je horší než žádná, protože vypadá jako provozní drobnost.
 */
export function keyringEnvFromConfig(config: {
  SECRET_KEY: { raw: string };
  SECRET_KEY_PREVIOUS: readonly { raw: string }[];
}): KeyringEnv {
  return {
    secretKey: config.SECRET_KEY.raw,
    secretKeyPrevious: config.SECRET_KEY_PREVIOUS.map((g) => g.raw).join(','),
  };
}

export function knownKeyIds(keyring: OpsKeyring): number[] {
  return [...keyring.fingerprints.keys()].sort((a, b) => a - b);
}

/** Pokolení, která se vyskytují v datech, ale instalace pro ně nemá klíč. */
export function missingGenerations(keyring: OpsKeyring, usedInData: readonly number[]): number[] {
  const known = new Set(keyring.fingerprints.keys());
  return [...new Set(usedInData)].filter((id) => !known.has(id)).sort((a, b) => a - b);
}
