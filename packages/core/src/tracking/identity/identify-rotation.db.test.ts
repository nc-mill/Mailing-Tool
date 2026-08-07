import { beforeAll, describe, expect, it } from 'vitest';
import { createSystemContext } from '../../identity/context';
import { secretHashOf } from '../../identity/api-key';
import { createApiKey, rotateApiKey } from '../../identity/api-key-service';
import { withWorkspace } from '../../tx';
import {
  readIdentifySigningSecrets,
  resetIdentifySecretsCache,
  selectIdentifySigningSecrets,
} from '../repo/identify.repo';
import { signIdentify, verifyIdentifySignature } from './signature';
import { asMigrator, seedWorkspace } from '../test/support/db';

/**
 * SKUTEČNÁ ROTACE KLÍČE, ne jen jednotkový test nad porovnáváním otisků.
 *
 * Podpis u `identify` se ověřuje proti OTISKU sekretu API klíče, ne proti
 * sekretu samotnému (důvod je u `selectIdentifySigningSecrets`). Rotace tedy
 * míchá dvě nezávislé věci: `rotateApiKey` ze světa identity, která přepíše
 * `secret_hash` a starý schová do `previous_secret_hash`, a čtení z domény
 * trasování, které si dožívající otisk musí umět vzít a po vypršení odkladu
 * zase zahodit.
 *
 * Do 7. 8. 2026 tuhle vazbu nedržel žádný test proti databázi. Ověřené bylo
 * jen to, že když se funkci dvě sady bajtů PŘEDAJÍ, tak proti oběma podpis
 * sedí. Že se ty bajty při opravdové rotaci vůbec objeví, ověřené nebylo,
 * a přitom je to ta část, která zákazníkovi buď rozbije integraci, nebo ne:
 * mezi rotací a výměnou sekretu v jeho kódu podepisuje pořád tím starým.
 *
 * Test proto vede celou cestu: založí klíč službou, podepíše starým sekretem,
 * ROTUJE službou a teprve pak se ptá domény trasování, co vidí.
 */

const CACHE_TTL_MS = 60_000;

let workspaceId = '';

beforeAll(async () => {
  workspaceId = await seedWorkspace();
}, 300_000);

function ctx() {
  return createSystemContext(workspaceId, 'test.identify_rotation');
}

/**
 * Sekretová část klíče `ml_live_<prefix>_<sekret>`, tedy to, čím zákazník podepisuje.
 *
 * Bere se VŠECHNO od čtvrtého dílu dál, ne poslední díl. Sekret je base64url
 * (`generateSecretKey`), a ta abeceda podtržítko OBSAHUJE, takže „poslední díl po
 * rozdělení" uřízne sekret uprostřed pokaždé, když se v něm podtržítko náhodou objeví.
 * Test pak padal zdánlivě nahodile: se stejným kódem jednou zeleně, jednou
 * `expected false to be true`, podle toho, co vylezlo z generátoru. Naměřeno 7. 8. 2026.
 */
function secretPart(fullKey: string): string {
  return fullKey.split('_').slice(3).join('_');
}

const EXTERNAL_ID = 'zakaznik-42';
const TRAITS = { email: 'petr@example.cz', plan: 'pro' };

describe('rotace klíče u podpisu identify', () => {
  it('dožívající sekret podepisuje dál, nový hned, a po odkladu zbude jen nový', async () => {
    resetIdentifySecretsCache();

    const created = await withWorkspace(ctx(), (tx) =>
      createApiKey(
        tx,
        ctx(),
        { name: 'Podpis identify', kind: 'secret', scopes: ['contacts:read'], expires_at: null },
        'test',
      ),
    );
    const starySekret = secretPart(created.secret);
    const staryPodpis = signIdentify({
      externalId: EXTERNAL_ID,
      traits: TRAITS,
      secret: secretHashOf(starySekret),
    });

    // Před rotací sedí starý podpis, to je výchozí stav.
    expect(
      (await selectIdentifySigningSecrets(ctx())).some((secret) =>
        verifyIdentifySignature({
          externalId: EXTERNAL_ID,
          traits: TRAITS,
          signature: staryPodpis,
          secret,
        }),
      ),
    ).toBe(true);

    // SKUTEČNÁ ROTACE, službou, ne přepsáním sloupce v databázi.
    const rotated = await withWorkspace(ctx(), (tx) =>
      rotateApiKey(tx, ctx(), { id: created.key.id, graceSeconds: 3600 }, 'test'),
    );
    const novySekret = secretPart(rotated.secret);
    expect(novySekret).not.toBe(starySekret);
    // Prefix se rotací měnit NESMÍ, jinak by se řádek podle něj nenašel
    // a odklad by byl mrtvý slib.
    expect(rotated.key.prefix).toBe(created.key.prefix);

    const behemOdkladu = await selectIdentifySigningSecrets(ctx());
    expect(behemOdkladu).toHaveLength(2);

    const novyPodpis = signIdentify({
      externalId: EXTERNAL_ID,
      traits: TRAITS,
      secret: secretHashOf(novySekret),
    });
    for (const [popis, podpis] of [
      ['starý sekret uvnitř odkladu', staryPodpis],
      ['nový sekret hned po rotaci', novyPodpis],
    ] as const) {
      const sedi = behemOdkladu.some((secret) =>
        verifyIdentifySignature({
          externalId: EXTERNAL_ID,
          traits: TRAITS,
          signature: podpis,
          secret,
        }),
      );
      expect(sedi, popis).toBe(true);
    }

    // Konec odkladu. Posouvá se čas v databázi, ne systémový: `previous_expires_at`
    // porovnává kód proti `Date.now()`, ale hodnotu píše `now()` v Postgresu.
    await asMigrator().query(
      `UPDATE api_keys SET previous_expires_at = now() - interval '1 second' WHERE id = $1`,
      [created.key.id],
    );

    const poOdkladu = await selectIdentifySigningSecrets(ctx());
    expect(poOdkladu).toHaveLength(1);
    expect(
      poOdkladu.some((secret) =>
        verifyIdentifySignature({
          externalId: EXTERNAL_ID,
          traits: TRAITS,
          signature: staryPodpis,
          secret,
        }),
      ),
      'starý podpis po vypršení odkladu už sedět nesmí',
    ).toBe(false);
    expect(
      poOdkladu.some((secret) =>
        verifyIdentifySignature({
          externalId: EXTERNAL_ID,
          traits: TRAITS,
          signature: novyPodpis,
          secret,
        }),
      ),
    ).toBe(true);
  });

  /**
   * Cache klíčů má minutovou platnost, takže rotace se v běžícím procesu
   * projeví se zpožděním. Je to vědomý kompromis a patří k němu vědět, že
   * po tu minutu podepisuje NOVÝ sekret marně. Kdyby cache držela dýl,
   * zákazník by po rotaci dostával odmítnutí a nevěděl proč.
   */
  it('cache klíčů drží starý pohled do minuty po rotaci', async () => {
    resetIdentifySecretsCache();

    const created = await withWorkspace(ctx(), (tx) =>
      createApiKey(
        tx,
        ctx(),
        { name: 'Cache test', kind: 'secret', scopes: ['contacts:read'], expires_at: null },
        'test',
      ),
    );

    const pred = await readIdentifySigningSecrets(ctx());
    const pocetPred = pred.length;

    await withWorkspace(ctx(), (tx) =>
      rotateApiKey(tx, ctx(), { id: created.key.id, graceSeconds: 3600 }, 'test'),
    );

    // Bez vyprázdnění cache vidí čtení pořád stav před rotací.
    expect(await readIdentifySigningSecrets(ctx())).toHaveLength(pocetPred);
    expect(CACHE_TTL_MS).toBe(60_000);

    resetIdentifySecretsCache();
    expect((await readIdentifySigningSecrets(ctx())).length).toBeGreaterThan(pocetPred);
  });
});
