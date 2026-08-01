import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { ApiError } from '../errors/api-error';
import {
  base32Lower,
  generateSecretKey,
  generatePublicKey,
  parseSecretKey,
  parsePublicKey,
  verifyApiKey,
  secretHashOf,
  PUBLIC_KEY_SCOPES,
  type ApiKeyRow,
} from './api-key';

/** Závazný vektor ze 3.5, přepočítaný spuštěním 2026-07-31. */
const VECTOR = {
  prefixBytes: 'a1b2c3d4e5',
  prefix: 'ugzmhvhf',
  secret: '__79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA',
  key: 'ml_live_ugzmhvhf___79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA',
  secretSha256: '7ac21015d6000ce73d6f61c420ff4d5f0f3cc816da25b10726b74e8961cd925c',
};

const row = (over: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: '0192f3a0-1c2d-7e44-8d4e-5f60718293a4',
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  kind: 'secret',
  scopes: ['contacts:read'],
  secretHash: Buffer.from(VECTOR.secretSha256, 'hex'),
  previousSecretHash: null,
  previousExpiresAt: null,
  revokedAt: null,
  expiresAt: null,
  workspaceDeletedAt: null,
  ...over,
});

describe('formát klíče (3.5)', () => {
  it('base32 prefix odpovídá závaznému vektoru', () => {
    expect(base32Lower(Buffer.from(VECTOR.prefixBytes, 'hex'))).toBe(VECTOR.prefix);
  });

  it('SHA-256 sekretu odpovídá vektoru', () => {
    expect(secretHashOf(VECTOR.secret).toString('hex')).toBe(VECTOR.secretSha256);
  });

  it('vygenerovaný tajný klíč má 60 znaků a správné části', () => {
    const generated = generateSecretKey();
    expect(generated.key).toHaveLength(60);
    expect(generated.key.startsWith(`ml_live_${generated.prefix}_`)).toBe(true);
    expect(generated.prefix).toMatch(/^[a-z2-7]{8}$/);
    expect(generated.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('prefix je base32, ne base64url, aby ho podtržítko nerozbilo', () => {
    for (let i = 0; i < 200; i += 1) expect(generateSecretKey().prefix).not.toContain('_');
  });

  it('veřejný klíč má tvar ml_pub_ a 16 znaků base32', () => {
    const generated = generatePublicKey();
    expect(generated.key).toMatch(/^ml_pub_[a-z2-7]{16}$/);
    expect(generated.prefix).toHaveLength(16);
  });

  it('veřejný klíč má pevně scope events:write a nic jiného', () => {
    expect(PUBLIC_KEY_SCOPES).toEqual(['events:write']);
  });
});

describe('parsování', () => {
  it('vektorový klíč se rozparsuje na prefix a sekret', () => {
    expect(parseSecretKey(VECTOR.key)).toEqual({
      env: 'live',
      prefix: VECTOR.prefix,
      secret: VECTOR.secret,
    });
  });

  it('klíč s jiným počtem znaků neprojde', () => {
    expect(parseSecretKey('ml_live_ugzmhvhf_kratky')).toBeNull();
  });

  it('klíč s neplatným prostředím neprojde', () => {
    expect(parseSecretKey(`ml_stage_${VECTOR.prefix}_${VECTOR.secret}`)).toBeNull();
  });

  it('veřejný klíč s 16 znaky projde', () => {
    expect(parsePublicKey('ml_pub_aebagbafaydqqcik')).toEqual({ prefix: 'aebagbafaydqqcik' });
  });

  it('veřejný klíč s jinou délkou neprojde', () => {
    expect(parsePublicKey('ml_pub_aebagbaf')).toBeNull();
  });

  it('veřejný klíč se znakem mimo base32 abecedu neprojde', () => {
    expect(parsePublicKey('ml_pub_aebagbafaydqqci9')).toBeNull();
  });
});

describe('ověření tajného klíče', () => {
  it('platný klíč projde a vrátí workspace a scopes', async () => {
    const load = vi.fn(async () => row());
    const verified = await verifyApiKey(VECTOR.key, load);
    expect(verified.workspaceId).toBe(row().workspaceId);
    expect(verified.scopes).toEqual(['contacts:read']);
    expect(verified.rotated).toBe(false);
  });

  it('neznámý prefix vrací unauthenticated a provede DVĚ dummy porovnání', async () => {
    const load = vi.fn(async () => null);
    const compares: number[] = [];
    await expect(
      verifyApiKey(VECTOR.key, load, { onCompare: () => compares.push(1) }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(compares).toHaveLength(2);
  });

  it('existující klíč bez previous hashe provede taky DVĚ porovnání', async () => {
    const compares: number[] = [];
    await verifyApiKey(VECTOR.key, async () => row(), { onCompare: () => compares.push(1) });
    expect(compares).toHaveLength(2);
  });

  it('špatný sekret vrací unauthenticated', async () => {
    const wrong = `ml_live_${VECTOR.prefix}_${'A'.repeat(43)}`;
    await expect(verifyApiKey(wrong, async () => row())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('kritérium 26c: sekret v grace období projde a nese příznak rotace', async () => {
    const previous = Buffer.from(VECTOR.secretSha256, 'hex');
    const verified = await verifyApiKey(VECTOR.key, async () =>
      row({
        secretHash: createHash('sha256').update('jiny-secret', 'ascii').digest(),
        previousSecretHash: previous,
        previousExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    expect(verified.rotated).toBe(true);
  });

  it('kritérium 26c: po vypršení grace období vrací unauthenticated', async () => {
    const previous = Buffer.from(VECTOR.secretSha256, 'hex');
    await expect(
      verifyApiKey(VECTOR.key, async () =>
        row({
          secretHash: createHash('sha256').update('jiny-secret', 'ascii').digest(),
          previousSecretHash: previous,
          previousExpiresAt: new Date(Date.now() - 1_000),
        }),
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('revokovaný klíč vrací unauthenticated', async () => {
    await expect(
      verifyApiKey(VECTOR.key, async () => row({ revokedAt: new Date() })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('expirovaný klíč vrací unauthenticated', async () => {
    await expect(
      verifyApiKey(VECTOR.key, async () => row({ expiresAt: new Date(Date.now() - 1000) })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('klíč smazaného projektu vrací unauthenticated', async () => {
    await expect(
      verifyApiKey(VECTOR.key, async () => row({ workspaceDeletedAt: new Date() })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('ověření veřejného klíče', () => {
  it('platný veřejný klíč projde se scope events:write', async () => {
    const verified = await verifyApiKey('ml_pub_aebagbafaydqqcik', async () =>
      row({ kind: 'public', secretHash: null, scopes: ['events:write'] }),
    );
    expect(verified.scopes).toEqual(['events:write']);
    expect(verified.kind).toBe('public');
  });

  it('kritérium 26b: vadné tělo vrací 401 BEZ jediného dotazu do databáze', async () => {
    const load = vi.fn(async () => row());
    for (const bad of ['ml_pub_aebagbaf', 'ml_pub_aebagbafaydqqci9', 'ml_pub_']) {
      await expect(verifyApiKey(bad, load)).rejects.toMatchObject({
        code: 'unauthenticated',
        status: 401,
      });
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('ve větvi veřejného klíče se neprovádí žádné porovnání hashů', async () => {
    const compares: number[] = [];
    await verifyApiKey(
      'ml_pub_aebagbafaydqqcik',
      async () => row({ kind: 'public', secretHash: null, scopes: ['events:write'] }),
      { onCompare: () => compares.push(1) },
    );
    expect(compares).toHaveLength(0);
  });

  it('nenalezený veřejný klíč vrací unauthenticated', async () => {
    await expect(verifyApiKey('ml_pub_aebagbafaydqqcik', async () => null)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});

describe('nesmyslné vstupy', () => {
  it('prázdný řetězec vrací 401 bez dotazu', async () => {
    const load = vi.fn(async () => row());
    await expect(verifyApiKey('', load)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(load).not.toHaveBeenCalled();
  });

  it('chyba nikdy nenese kód forbidden ani not_found', async () => {
    try {
      await verifyApiKey('nesmysl', async () => null);
    } catch (e) {
      expect(['forbidden', 'not_found']).not.toContain((e as ApiError).code);
    }
  });
});

/**
 * Kritérium 26: ověření sekretu je časově konstantní. Měří se skutečný běh.
 *
 * MĚŘÍ SE SPRÁVNÁ DVOJICE, a stojí za to říct proč. Naivní varianta „správný
 * versus špatný sekret" NIC UŽITEČNÉHO NEŘÍKÁ a spolehlivě selže: neúspěšná
 * cesta navíc konstruuje `ApiError`, tedy `Error` se stack trace, což je
 * naměřitelně dražší než vrátit objekt (naměřeno 0,0025 ms proti 0,0077 ms).
 * Nic to ale neprozrazuje: jestli klíč prošel, se útočník dozví ze stavového
 * kódu odpovědi, ne z hodinek.
 *
 * Chráněná informace je jiná: KOLIK bajtů sekretu už útočník uhodl a JESTLI
 * daný prefix vůbec existuje. Testují se proto dvě dvojice neúspěšných cest:
 *   1. hash lišící se v PRVNÍM bajtu proti hashi lišícímu se v POSLEDNÍM.
 *      Kdyby porovnání končilo na první neshodě, byla by první varianta
 *      měřitelně rychlejší a klíč by šlo uhodnout po bajtech.
 *   2. neznámý prefix (dvě dummy porovnání) proti známému prefixu se špatným
 *      sekretem (dvě skutečná porovnání). Kdyby se lišily, dal by se výpis
 *      existujících klíčů získat měřením.
 */
describe('kritérium 26: časově konstantní ověření', () => {
  const BATCHES = 25;
  const PER_BATCH = 400;

  /**
   * Měří v dávkách: jedno ověření trvá jednotky mikrosekund, což je pod šumem
   * hodin. Z dávek se bere MINIMUM, ne medián. Šum plánovače, GC a souběžně
   * běžících testovacích souborů umí čas jen PŘIDAT, takže nejrychlejší dávka
   * je nejbližší skutečné ceně kódu a je stabilní i pod zátěží; medián by
   * v paralelním běhu celé sady kolísal a test by blikal.
   */
  async function fastestBatchMs(
    key: string,
    load: () => Promise<ApiKeyRow | null>,
  ): Promise<number> {
    const batches: number[] = [];
    for (let b = 0; b < BATCHES; b += 1) {
      const started = process.hrtime.bigint();
      for (let i = 0; i < PER_BATCH; i += 1) {
        await verifyApiKey(key, load).catch(() => undefined);
      }
      batches.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    return Math.min(...batches);
  }

  const flipped = (index: number): Buffer => {
    const hash = Buffer.from(VECTOR.secretSha256, 'hex');
    hash[index] = hash[index]! ^ 0xff;
    return hash;
  };

  it('neshoda v prvním bajtu trvá stejně dlouho jako neshoda v posledním', async () => {
    const first = async () => row({ secretHash: flipped(0) });
    const last = async () => row({ secretHash: flipped(31) });

    await fastestBatchMs(VECTOR.key, first);
    await fastestBatchMs(VECTOR.key, last);

    const a = await fastestBatchMs(VECTOR.key, first);
    const b = await fastestBatchMs(VECTOR.key, last);
    const relativeDifference = Math.abs(a - b) / Math.max(a, b);
    process.stdout.write(
      `[kriterium 26] neshoda v 1. bajtu ${a.toFixed(3)} ms/${PER_BATCH}, v 32. bajtu ${b.toFixed(3)} ms/${PER_BATCH}, rozdil ${(relativeDifference * 100).toFixed(2)} %\n`,
    );
    expect(relativeDifference).toBeLessThan(0.2);
  }, 120_000);

  it('neznámý prefix trvá stejně dlouho jako známý prefix se špatným sekretem', async () => {
    const missing = async () => null;
    const wrongSecret = async () => row({ secretHash: flipped(0) });

    await fastestBatchMs(VECTOR.key, missing);
    await fastestBatchMs(VECTOR.key, wrongSecret);

    const a = await fastestBatchMs(VECTOR.key, missing);
    const b = await fastestBatchMs(VECTOR.key, wrongSecret);
    const relativeDifference = Math.abs(a - b) / Math.max(a, b);
    process.stdout.write(
      `[kriterium 26] neznamy prefix ${a.toFixed(3)} ms/${PER_BATCH}, spatny sekret ${b.toFixed(3)} ms/${PER_BATCH}, rozdil ${(relativeDifference * 100).toFixed(2)} %\n`,
    );
    expect(relativeDifference).toBeLessThan(0.2);
  }, 120_000);
});
