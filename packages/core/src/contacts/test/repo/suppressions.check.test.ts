import { describe, expect, it } from 'vitest';
import { addSuppression, checkSuppression, removeSuppression } from '../../repo/suppressions';
import { testContext } from '../support/db';
import { countSuppressionQueries, insertErasedSuppression, withKeyring } from '../support/phase-c';

describe('checkSuppression', () => {
  it('najde blokovanou adresu podle plaintextu', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'hard_bounce', source: 'test' });
    expect((await checkSuppression(ctx, ['j@x.cz'])).get('j@x.cz')?.reason).toBe('hard_bounce');
  });

  it('adresa se porovnává bez ohledu na velikost písmen', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'manual', source: 'test' });
    expect((await checkSuppression(ctx, ['J@X.CZ'])).size).toBe(1);
  });

  it('PODMÍNKA 1: odebraná blokace se ignoruje', async () => {
    const ctx = await testContext();
    const { suppressionId } = await addSuppression(ctx, {
      email: 'j@x.cz',
      reason: 'manual',
      source: 'test',
    });
    await removeSuppression(ctx, suppressionId, { note: 'omyl' });
    // Bez removed_at IS NULL by adresa odblokovaná podle matice zůstala vyloučená
    // navždy, protože měkce odebraný řádek v tabulce zůstává. Odblokování by bylo
    // tiše bez efektu a nikdo by nepoznal proč. Kritérium 76.
    expect((await checkSuppression(ctx, ['j@x.cz'])).size).toBe(0);
  });

  it('PODMÍNKA 2: najde adresu podle otisku, když je plaintext placeholder', async () => {
    const ctx = await testContext();
    // Simulace stavu po výmazu podle článku 17: v email je placeholder, plaintext je pryč.
    await insertErasedSuppression(ctx, { originalEmail: 'j@x.cz' });
    // Kritérium 77: bez větve přes fingerprint by šlo vymazaného člověka naimportovat zpět.
    expect((await checkSuppression(ctx, ['j@x.cz'])).get('j@x.cz')?.reason).toBe('gdpr_erasure');
  });

  it('PODMÍNKA 3: najde otisk zapsaný STARÝM klíčem i po rotaci', async () => {
    const ctx = await testContext();
    await withKeyring({ current: 1, all: [1] }, async () => {
      await insertErasedSuppression(ctx, { originalEmail: 'j@x.cz' });
    });
    // Rotace: nový klíč je aktuální, starý zůstává v SECRET_KEY_PREVIOUS.
    await withKeyring({ current: 2, all: [1, 2] }, async () => {
      // Kritérium 78. Bez hledání přes všechna pokolení by se vymazaný člověk vrátil
      // prvním dalším importem, aniž by cokoliv selhalo nebo se zalogovalo.
      expect((await checkSuppression(ctx, ['j@x.cz'])).size).toBe(1);
    });
  });

  it('PODMÍNKA 3: funguje i po pěti rotacích, žádný strop neexistuje', async () => {
    const ctx = await testContext();
    await withKeyring({ current: 1, all: [1] }, async () => {
      await insertErasedSuppression(ctx, { originalEmail: 'j@x.cz' });
    });
    await withKeyring({ current: 6, all: [1, 2, 3, 4, 5, 6] }, async () => {
      expect((await checkSuppression(ctx, ['j@x.cz'])).size).toBe(1);
    });
  });

  it('otisk zapsaný klíčem, který v keyringu NENÍ, se nenajde', async () => {
    const ctx = await testContext();
    await withKeyring({ current: 1, all: [1] }, async () => {
      await insertErasedSuppression(ctx, { originalEmail: 'j@x.cz' });
    });
    // Kontrolní pokus opačným směrem: kdyby test výše procházel z jiného důvodu než
    // kvůli starému pokolení v keyringu, prošel by i tenhle a byl by bezcenný.
    await withKeyring({ current: 2, all: [2] }, async () => {
      expect((await checkSuppression(ctx, ['j@x.cz'])).size).toBe(0);
    });
  });

  it('dávková kontrola vrátí mapu jen pro blokované adresy', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'a@x.cz', reason: 'manual', source: 'test' });
    const result = await checkSuppression(ctx, ['a@x.cz', 'b@x.cz', 'c@x.cz']);
    expect([...result.keys()]).toEqual(['a@x.cz']);
  });

  it('dávka tisíce adres proběhne jedním dotazem', async () => {
    const ctx = await testContext();
    const emails = Array.from({ length: 1000 }, (_, i) => `u${i}@x.cz`);
    const queries = await countSuppressionQueries(() => checkSuppression(ctx, emails));
    expect(queries).toBe(1);
  });

  it('cizí projekt blokaci nevidí', async () => {
    const a = await testContext();
    const b = await testContext();
    await addSuppression(a, { email: 'j@x.cz', reason: 'manual', source: 'test' });
    expect((await checkSuppression(b, ['j@x.cz'])).size).toBe(0);
  });

  it('prázdný seznam adres nedělá dotaz vůbec', async () => {
    const ctx = await testContext();
    const queries = await countSuppressionQueries(async () => {
      expect((await checkSuppression(ctx, [])).size).toBe(0);
    });
    expect(queries).toBe(0);
  });
});
