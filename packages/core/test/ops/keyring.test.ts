import { describe, expect, it } from 'vitest';
import { knownKeyIds, loadOpsKeyring, missingGenerations } from '../../src/ops/keyring';

const SPEC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('loadOpsKeyring', () => {
  it('spočítá otisk podle vektoru ze specifikace', () => {
    const kr = loadOpsKeyring({ secretKey: SPEC_KEY, secretKeyPrevious: '' });
    expect(kr.currentFingerprint).toBe('VXGoNjoPSBY');
  });

  it('neodvozuje klíč dvakrát', () => {
    // Nejsnazší chyba v tomhle modulu je zavolat secretKeyFingerprint()
    // s UŽ ODVOZENÝM klíčem. Přeloží se to, nespadne to a vyrobí to tiše
    // jiný otisk, kterým by pak `mlain doctor` hlásil kritickou neshodu
    // klíče u instalace, které nic není.
    //
    // Obě hodnoty jsou ověřené spuštěním nad kontraktem P02:
    //   secretKeyFingerprint(master)                     -> VXGoNjoPSBY
    //   secretKeyFingerprint(deriveKey(master, PURPOSE)) -> 5P_j-3XY714
    const kr = loadOpsKeyring({ secretKey: SPEC_KEY, secretKeyPrevious: '' });
    expect(kr.currentFingerprint).not.toBe('5P_j-3XY714');
  });

  it('bez explicitního key_id má aktuální klíč id 1', () => {
    const kr = loadOpsKeyring({ secretKey: SPEC_KEY, secretKeyPrevious: '' });
    expect(kr.currentKeyId).toBe(1);
    expect(knownKeyIds(kr)).toEqual([1]);
  });

  it('načte všechna předchozí pokolení a nemá horní strop', () => {
    const previous = Array.from({ length: 12 }, (_, i) => `${i + 1}:${SPEC_KEY}`).join(',');
    const kr = loadOpsKeyring({ secretKey: `13:${SPEC_KEY}`, secretKeyPrevious: previous });
    expect(kr.currentKeyId).toBe(13);
    expect(knownKeyIds(kr)).toHaveLength(13);
  });
});

describe('missingGenerations', () => {
  it('vrátí pokolení, která jsou v datech, ale ne v keyringu', () => {
    const kr = loadOpsKeyring({ secretKey: `3:${SPEC_KEY}`, secretKeyPrevious: `2:${SPEC_KEY}` });
    expect(missingGenerations(kr, [1, 2, 3])).toEqual([1]);
  });

  it('prázdná data znamenají žádné chybějící pokolení', () => {
    const kr = loadOpsKeyring({ secretKey: SPEC_KEY, secretKeyPrevious: '' });
    expect(missingGenerations(kr, [])).toEqual([]);
  });
});
