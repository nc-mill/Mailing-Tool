import { describe, it, expect } from 'vitest';
import { ApiError } from '../errors/api-error';
import {
  ARGON2_PARAMS,
  hashPassword,
  verifyPassword,
  needsRehash,
  assertPasswordPolicy,
  normalizePassword,
  DUMMY_PASSWORD_HASH,
  commonPasswordCount,
} from './password';

describe('parametry Argon2id', () => {
  it('odpovídají OWASP variantě s nejnižší pamětí (3.1)', () => {
    expect(ARGON2_PARAMS).toEqual({
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
  });

  it('hash je PHC řetězec argon2id s deklarovanými parametry', async () => {
    const hash = await hashPassword('spravne-dlouhe-heslo');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });
});

describe('ověření hesla', () => {
  it('správné heslo projde', async () => {
    const hash = await hashPassword('spravne-dlouhe-heslo');
    expect(await verifyPassword(hash, 'spravne-dlouhe-heslo')).toBe(true);
  });

  it('špatné heslo neprojde', async () => {
    const hash = await hashPassword('spravne-dlouhe-heslo');
    expect(await verifyPassword(hash, 'jine-dlouhe-heslo1')).toBe(false);
  });

  it('poškozený PHC řetězec vrátí false a nehodí výjimku', async () => {
    expect(await verifyPassword('tohle-neni-phc', 'spravne-dlouhe-heslo')).toBe(false);
  });

  it('dummy hash existuje, je platný a nikdy se s ním nedá přihlásit', async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword(DUMMY_PASSWORD_HASH, 'spravne-dlouhe-heslo')).toBe(false);
  });

  it('normalizace NFKC probíhá před hashováním', async () => {
    // Stejný znak zapsaný dvěma způsoby: předkomponovaný a s kombinující čárkou.
    const composed = 'nekonecne-heslo-é';
    const decomposed = 'nekonecne-heslo-é';
    const hash = await hashPassword(composed);
    expect(await verifyPassword(hash, decomposed)).toBe(true);
  });

  it('normalizePassword vrací NFKC podobu', () => {
    expect(normalizePassword('é').normalize('NFKC')).toBe(normalizePassword('é'));
  });
});

describe('rehash', () => {
  it('aktuální parametry rehash nevyžadují', async () => {
    expect(needsRehash(await hashPassword('spravne-dlouhe-heslo'))).toBe(false);
  });

  it('slabší parametry rehash vyžadují', () => {
    expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true);
  });

  it('jiný algoritmus vyžaduje rehash', () => {
    expect(needsRehash('$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true);
  });
});

describe('pravidla hesla (3.1)', () => {
  it('12 znaků projde', () => {
    expect(() => assertPasswordPolicy('abcdefghijkl', 'petr@example.cz')).not.toThrow();
  });

  it('11 znaků končí 422', () => {
    expect(() => assertPasswordPolicy('abcdefghijk', 'petr@example.cz')).toThrow(ApiError);
  });

  it('257 znaků se odmítne, neořezává se', () => {
    try {
      assertPasswordPolicy('a'.repeat(257), 'petr@example.cz');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).errors?.[0]?.code).toBe('password_too_long');
    }
  });

  it('256 znaků ještě projde', () => {
    expect(() => assertPasswordPolicy('a'.repeat(256), 'petr@example.cz')).not.toThrow();
  });

  it('žádné povinné třídy znaků', () => {
    expect(() => assertPasswordPolicy('aaaaaaaaaaaaaaaa', 'petr@example.cz')).not.toThrow();
  });

  it('heslo z blocklistu se odmítne bez ohledu na velikost písmen', () => {
    // Odchylka od plánu: plán tu měl 'Password1234', jenže to heslo v seznamu
    // SecLists top-10000 NENÍ (ověřeno stažením, leží až na pozici 31843
    // v top-100000). 'qwerty123456' v něm je na pozici 2750 a má potřebných
    // 12 znaků, takže se projde přes kontrolu délky až na blocklist.
    expect(() => assertPasswordPolicy('Qwerty123456', 'petr@example.cz')).toThrow(ApiError);
  });

  it('heslo obsahující lokální část e-mailu se odmítne', () => {
    try {
      assertPasswordPolicy('petr-tajne-heslo', 'petr@example.cz');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).errors?.[0]?.code).toBe('password_contains_email');
    }
  });

  it('blocklist má 10 000 položek', () => {
    expect(commonPasswordCount()).toBe(10000);
  });
});
