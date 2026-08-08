import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
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

/**
 * Záznam o každém volání `crypto.timingSafeEqual`, na kterém stojí kritérium 26
 * (viz poslední describe v tomhle souboru).
 *
 * Mock je tu proto, že jinak se na tu funkci z testu nedosáhne: `api-key.ts` si
 * ji naváže named importem při načtení modulu a `vi.spyOn` nad namespace
 * vestavěného modulu tu vazbu už nezmění. Skutečná implementace se VOLÁ DÁL,
 * obal jen zapisuje, s čím se volala; chování ověřování se tím nemění a všech
 * ostatních 28 testů v souboru běží nad pravým `node:crypto`.
 */
type TimingSafeEqualCall = {
  /** Délky obou operandů. Musí být 32 a 32, tedy celý SHA-256, ne výřez. */
  lengths: [number, number];
  /** Index prvního rozdílného bajtu, nebo -1 při shodě. */
  firstDifferentByte: number;
};

const cryptoCalls = vi.hoisted(() => ({ timingSafeEqual: [] as TimingSafeEqualCall[] }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return {
    ...actual,
    timingSafeEqual(a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView): boolean {
      const left = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
      const right = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
      let firstDifferentByte = -1;
      for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
        if (left[i] !== right[i]) {
          firstDifferentByte = i;
          break;
        }
      }
      cryptoCalls.timingSafeEqual.push({
        lengths: [left.length, right.length],
        firstDifferentByte,
      });
      return actual.timingSafeEqual(a, b);
    },
  };
});

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
 * Kritérium 26: ověření sekretu je časově konstantní.
 *
 * Chráněná informace je dvojí: KOLIK bajtů sekretu už útočník uhodl a JESTLI
 * daný prefix vůbec existuje. Každou z nich hlídá jiný test a KAŽDOU JINÝM
 * NÁSTROJEM, protože ty dvě vady mají řádově jinou velikost.
 *
 * 1. Bajty sekretu. Tady se NEMĚŘÍ, ověřuje se struktura: že porovnání hashů
 *    projde `crypto.timingSafeEqual` a že do něj jde celých 32 bajtů.
 *
 *    Do 8. 8. 2026 tu stálo měření hodinami s tolerancí 20 % a bylo SLEPÉ.
 *    Naměřeno na tomhle repozitáři (Node 24, Apple silicon): jedno neúspěšné
 *    ověření stojí kolem 5,2 µs a skoro celé je to SHA-256 sekretu a konstrukce
 *    `ApiError`; samotné porovnání 32 bajtů zabere 0,04 µs. Rozdíl mezi
 *    neshodou v 1. a ve 32. bajtu, tedy 31 ušetřených porovnání jednoho bajtu,
 *    se v tom utopí. Ověřeno spuštěním, ne odvozeno: tentýž harness (25 dávek
 *    po 400, minimum) pouštěný nad ÚMYSLNĚ zranitelnou bajtovou smyčkou
 *    s předčasným návratem hlásil rozdíly 2,50 %, 7,95 % a 0,88 %, tedy třikrát
 *    zelenou, a znaménko i velikost se měnily náhodně. Test měl v názvu jednu
 *    věc a tvrdil druhou, k tomu na sdíleném runneru CI blikal.
 *
 *    Kontrola přes `timingSafeEqual` je proti tomu přesná, nezávislá na
 *    vytížení stroje a dokazuje víc: konstantní čas garantuje sama ta funkce,
 *    stačí ukázat, že se skutečně volá a nad celým hashem.
 *
 * 2. Existence prefixu. Tady měření smysl dává a zůstává. Rozdíl mezi větvemi
 *    není pár bajtů, ale celý SHA-256 sekretu plus dvě dummy porovnání.
 *    Ověřeno mutací: když se z větve s neznámým prefixem obojí odstraní a vrací
 *    401 rovnou, hlásí měření 29,9 až 33,9 % ve všech pěti pokusech, takže
 *    20% tolerance to spolehlivě chytí. Že jsou dummy porovnání právě dvě,
 *    přesně počítají testy „provede DVĚ dummy porovnání" výš.
 *
 * Naivní dvojice „správný versus špatný sekret" se neměří schválně: neúspěšná
 * cesta konstruuje `ApiError`, tedy `Error` se stack trace, a je tím pádem
 * dražší. Nic to ale neprozrazuje, jestli klíč prošel, se útočník dozví ze
 * stavového kódu odpovědi, ne z hodinek.
 */
describe('kritérium 26: časově konstantní ověření', () => {
  const BATCHES = 25;
  const PER_BATCH = 400;
  /** Strop relativního rozdílu obou větví. Viz bod 2 v komentáři výš. */
  const TOLERANCE = 0.2;
  /** Kolikrát se smí celé měření zopakovat, než se test prohlásí za spadlý. */
  const ATTEMPTS = 5;

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

  /**
   * Změří obě větve a porovná je. Celé měření se smí zopakovat až `ATTEMPTS`krát
   * a projde první pokus, který se do tolerance vejde.
   *
   * TOLERANCE SE TÍM NEZVĚTŠUJE, opakuje se jen měření, a je v tom rozdíl:
   * skutečný systematický rozdíl mezi větvemi vyjde ve VŠECH pokusech, kdežto
   * výkyv plánovače se v dalším pokusu neopakuje. Runner CI má 4 vCPU a běží na
   * něm tři vlákna vitestu a k tomu ostatní balíčky turba, takže na jednorázové
   * měření spoléhat nejde; přesně na tom tu 8. 8. 2026 spadl sesterský test,
   * jehož obě větve dělají prokazatelně totéž.
   *
   * Do hlášky jdou VŠECHNY pokusy, aby šlo poznat rozptyl od posunu.
   */
  async function expectSameCost(
    label: string,
    a: { name: string; load: () => Promise<ApiKeyRow | null> },
    b: { name: string; load: () => Promise<ApiKeyRow | null> },
  ): Promise<void> {
    // Rozehřátí JIT, aby první pokus neplatil za obě větve.
    await fastestBatchMs(VECTOR.key, a.load);
    await fastestBatchMs(VECTOR.key, b.load);

    const measured: string[] = [];
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const left = await fastestBatchMs(VECTOR.key, a.load);
      const right = await fastestBatchMs(VECTOR.key, b.load);
      const relativeDifference = Math.abs(left - right) / Math.max(left, right);
      const line =
        `${a.name} ${left.toFixed(3)} ms/${PER_BATCH}, ${b.name} ${right.toFixed(3)} ms/${PER_BATCH}, ` +
        `rozdil ${(relativeDifference * 100).toFixed(2)} %`;
      measured.push(line);
      if (relativeDifference < TOLERANCE) {
        process.stdout.write(`[kriterium 26] ${label}: ${line} (pokus ${attempt}/${ATTEMPTS})\n`);
        return;
      }
    }
    expect.fail(
      `[kriterium 26] ${label}: ani jeden z ${ATTEMPTS} pokusů se nevešel do ` +
        `${TOLERANCE * 100} %:\n  ${measured.join('\n  ')}`,
    );
  }

  const flipped = (index: number): Buffer => {
    const hash = Buffer.from(VECTOR.secretSha256, 'hex');
    hash[index] = hash[index]! ^ 0xff;
    return hash;
  };

  /** Volání `timingSafeEqual`, ke kterým došlo během jednoho ověření. */
  async function comparisonsDuringVerify(secretHash: Buffer): Promise<TimingSafeEqualCall[]> {
    cryptoCalls.timingSafeEqual.length = 0;
    await verifyApiKey(VECTOR.key, async () => row({ secretHash })).catch(() => undefined);
    return [...cryptoCalls.timingSafeEqual];
  }

  it('neshoda v prvním bajtu se vyhodnocuje stejně jako neshoda v posledním', async () => {
    const first = await comparisonsDuringVerify(flipped(0));
    const last = await comparisonsDuringVerify(flipped(31));

    // Porovnání vůbec proběhla, a proběhla přes `timingSafeEqual`. Kdyby někdo
    // `constantTimeEqual` přepsal na `a.equals(b)` nebo na vlastní smyčku,
    // zůstane tenhle seznam prázdný a test spadne. To je jádro věci: konstantní
    // čas neslibuje náš kód, slibuje ho ta funkce.
    expect(first).toHaveLength(2);
    expect(last).toHaveLength(first.length);

    // Do porovnání jde CELÝ hash, ne prvních pár bajtů. Porovnání zkráceného
    // úseku by bylo taky konstantní v čase, a přesto by klíč šlo uhodnout.
    for (const call of [...first, ...last]) expect(call.lengths).toEqual([32, 32]);

    // A pojistka na samotnou fixturu: obě ověření se opravdu liší tam, kde mají.
    // Bez tohohle by test mohl dvakrát porovnávat totéž a nic by nehlídal.
    expect(first[0]!.firstDifferentByte).toBe(0);
    expect(last[0]!.firstDifferentByte).toBe(31);
  });

  it('neznámý prefix trvá stejně dlouho jako známý prefix se špatným sekretem', async () => {
    await expectSameCost(
      'existence prefixu',
      { name: 'neznamy prefix', load: async () => null },
      { name: 'spatny sekret', load: async () => row({ secretHash: flipped(0) }) },
    );
  }, 120_000);
});
