import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KEY_PURPOSES, type Keyring } from '@mlain/contracts/keyring';
import {
  computeAllFingerprints,
  computeAllFingerprintsBatch,
  computeCurrentFingerprint,
} from '../fingerprint';

/**
 * Testovací keyring se třemi pokoleními, aby šlo ověřit chování po rotaci.
 * Tvar je z kontraktu P02: Keyring je Map<number, Uint8Array>, ne vlastní objekt.
 */
const keyring: Keyring = new Map([
  [1, new Uint8Array(32).fill(1)],
  [2, new Uint8Array(32).fill(2)],
  [3, new Uint8Array(32).fill(3)],
]);

/** Nezávislý přepočet receptu z kapitoly 3.10 části 1, aby test neopisoval implementaci. */
function expectedFingerprint(master: Uint8Array, email: string): Buffer {
  const derived = Buffer.from(
    hkdfSync(
      'sha256',
      master,
      Buffer.from('mailer/v1', 'ascii'),
      Buffer.from('mailer/v1/suppression-fingerprint', 'ascii'),
      32,
    ),
  );
  return createHmac('sha256', derived).update(email.toLowerCase(), 'utf8').digest();
}

describe('purpose', () => {
  // Purpose si tenhle plán NEDEFINUJE. Vlastní ho kontrakt P02 a tenhle modul
  // ho jen konzumuje, protože dvě konstanty s týmž významem se rozejdou a rozdíl
  // se pozná až tím, že vymazaný člověk dostane mail.
  it('je přesně ten zmrazený řetězec z kontraktu', () => {
    expect(KEY_PURPOSES.suppressionFingerprint).toBe('mailer/v1/suppression-fingerprint');
  });

  it('neobsahuje jméno produktu, takže ho přejmenování nerozbije', () => {
    expect(KEY_PURPOSES.suppressionFingerprint.toLowerCase()).not.toContain('mlain');
  });
});

describe('computeCurrentFingerprint', () => {
  it('počítá HMAC odvozeným klíčem aktuálního pokolení', () => {
    const result = computeCurrentFingerprint(keyring, 'jan@x.cz');
    expect(result.keyId).toBe(3);
    expect(result.fingerprint.equals(expectedFingerprint(keyring.get(3)!, 'jan@x.cz'))).toBe(true);
  });

  it('adresa se před výpočtem převádí na malá písmena', () => {
    expect(
      computeCurrentFingerprint(keyring, 'JAN@X.CZ').fingerprint.equals(
        computeCurrentFingerprint(keyring, 'jan@x.cz').fingerprint,
      ),
    ).toBe(true);
  });

  it('otisk má 32 bajtů', () => {
    expect(computeCurrentFingerprint(keyring, 'jan@x.cz').fingerprint).toHaveLength(32);
  });
});

describe('computeAllFingerprints', () => {
  it('vrátí otisk pro KAŽDÉ známé pokolení, bez horního stropu', () => {
    const all = computeAllFingerprints(keyring, 'jan@x.cz');
    expect(all).toHaveLength(3);
    for (const master of keyring.values()) {
      expect(all.some((f) => f.equals(expectedFingerprint(master, 'jan@x.cz')))).toBe(true);
    }
  });

  it('nemá strop ani při deseti pokoleních, regrese proti zrušenému limitu šesti', () => {
    const many: Keyring = new Map(
      Array.from({ length: 10 }, (_, i) => [i + 1, new Uint8Array(32).fill(i + 1)]),
    );
    expect(computeAllFingerprints(many, 'jan@x.cz')).toHaveLength(10);
  });

  it('nemá strop ani při padesáti pokoleních', () => {
    const many: Keyring = new Map(
      Array.from({ length: 50 }, (_, i) => [i + 1, new Uint8Array(32).fill((i % 255) + 1)]),
    );
    expect(computeAllFingerprints(many, 'jan@x.cz')).toHaveLength(50);
  });

  it('otisk spočítaný starým klíčem je mezi vrácenými i po rotaci', () => {
    const beforeRotation: Keyring = new Map([[1, new Uint8Array(32).fill(1)]]);
    const old = computeCurrentFingerprint(beforeRotation, 'jan@x.cz').fingerprint;
    expect(computeAllFingerprints(keyring, 'jan@x.cz').some((f) => f.equals(old))).toBe(true);
  });

  it('otisky jsou deterministické', () => {
    expect(computeAllFingerprints(keyring, 'jan@x.cz').map((b) => b.toString('hex'))).toEqual(
      computeAllFingerprints(keyring, 'jan@x.cz').map((b) => b.toString('hex')),
    );
  });

  it('různé adresy dávají různé otisky', () => {
    expect(computeCurrentFingerprint(keyring, 'jan@x.cz').fingerprint.toString('hex')).not.toBe(
      computeCurrentFingerprint(keyring, 'petr@x.cz').fingerprint.toString('hex'),
    );
  });

  it('prázdný keyring je chyba, ne prázdné pole', () => {
    expect(() => computeAllFingerprints(new Map(), 'jan@x.cz')).toThrow(/keyring/i);
  });
});

describe('computeAllFingerprintsBatch', () => {
  it('vrátí počet adres krát počet pokolení', () => {
    expect(computeAllFingerprintsBatch(keyring, ['a@x.cz', 'b@x.cz'])).toHaveLength(6);
  });

  it('dává tytéž hodnoty jako jednotlivé volání', () => {
    const batch = computeAllFingerprintsBatch(keyring, ['a@x.cz']).map((b) => b.toString('hex'));
    const single = computeAllFingerprints(keyring, 'a@x.cz').map((b) => b.toString('hex'));
    expect(batch).toEqual(single);
  });
});
