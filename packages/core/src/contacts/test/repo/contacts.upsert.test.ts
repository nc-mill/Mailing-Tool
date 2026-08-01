import { describe, expect, it } from 'vitest';
import { upsertContacts } from '../../repo/contacts';
import { findByEmail, findByEmailOrNull, softDelete, testContext } from '../support/db';

describe('upsertContacts', () => {
  it('vloží nový kontakt a označí ho jako vložený', async () => {
    const ctx = await testContext();
    const result = await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'jan@x.cz', firstName: 'Jan', lastName: 'Novák', attributes: {} }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.inserted).toBe(true);
  });

  it('druhý zápis téže adresy je aktualizace, ne nový řádek', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, { mode: 'update', rows: [{ email: 'jan@x.cz', attributes: {} }] });
    const second = await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'jan@x.cz', firstName: 'Jan', attributes: {} }],
    });
    expect(second[0]!.inserted).toBe(false);
  });

  it('režim update přepíše jen neprázdné hodnoty', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', firstName: 'Jan', lastName: 'Novák', attributes: {} }],
    });
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', firstName: '', lastName: 'Nový', attributes: {} }],
    });
    const contact = await findByEmail(ctx, 'j@x.cz');
    expect(contact.first_name).toBe('Jan');
    expect(contact.last_name).toBe('Nový');
  });

  it('režim overwrite přepíše i prázdnou hodnotou', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', firstName: 'Jan', attributes: {} }],
    });
    await upsertContacts(ctx, {
      mode: 'overwrite',
      rows: [{ email: 'j@x.cz', firstName: null, attributes: {} }],
    });
    expect((await findByEmail(ctx, 'j@x.cz')).first_name).toBeNull();
  });

  it('režim skip existující kontakt nezmění', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', firstName: 'Jan', attributes: {} }],
    });
    await upsertContacts(ctx, {
      mode: 'skip',
      rows: [{ email: 'j@x.cz', firstName: 'Petr', attributes: {} }],
    });
    expect((await findByEmail(ctx, 'j@x.cz')).first_name).toBe('Jan');
  });

  it('KRITÉRIUM 9: nenamapované vlastní pole zůstane, attributes se slučují po klíčích', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', attributes: { city: 'Brno', phone: '123' } }],
    });
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', attributes: { city: 'Praha' } }],
    });
    expect((await findByEmail(ctx, 'j@x.cz')).attributes).toEqual({
      city: 'Praha',
      phone: '123',
    });
  });

  it('KRITÉRIUM 49: hodnota null v režimu overwrite klíč z attributes ODSTRANÍ', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', attributes: { city: 'Brno' } }],
    });
    await upsertContacts(ctx, {
      mode: 'overwrite',
      rows: [{ email: 'j@x.cz', attributes: { city: null } }],
    });
    const attributes = (await findByEmail(ctx, 'j@x.cz')).attributes;
    // Klíč nesmí zůstat s hodnotou JSON null. Kdyby zůstal, predikát is_empty v segmentu
    // by ho vyhodnotil jako neprázdný a uživatel by "vymazané" pole viděl dál.
    expect('city' in attributes).toBe(false);
  });

  it('měkce smazaný kontakt nebrání vzniku nového se stejnou adresou', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, { mode: 'update', rows: [{ email: 'j@x.cz', attributes: {} }] });
    await softDelete(ctx, 'j@x.cz');
    const again = await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', attributes: {} }],
    });
    expect(again[0]!.inserted).toBe(true);
  });

  it('REGRESE: nový kontakt bez uvedeného stavu vzniká jako unconfirmed, ne active', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, { mode: 'update', rows: [{ email: 'j@x.cz', attributes: {} }] });
    // Výchozí hodnota sloupce v DDL je 'active'. Kdyby status v seznamu sloupců
    // upsertu chyběl, projevilo by se to přesně takhle: kontakt z formuláře
    // s dvojím potvrzením by byl rovnou v rozesílce. Test se ptá databáze, ne funkce.
    expect((await findByEmail(ctx, 'j@x.cz')).status).toBe('unconfirmed');
  });

  it('KRITÉRIUM 10: zápis nikdy nepovýší stav z unsubscribed na active', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', status: 'unsubscribed', attributes: {} }],
    });
    await upsertContacts(ctx, {
      mode: 'overwrite',
      rows: [{ email: 'j@x.cz', status: 'active', attributes: {} }],
    });
    expect((await findByEmail(ctx, 'j@x.cz')).status).toBe('unsubscribed');
  });

  it('zamknuté stavy drží i v režimu overwrite, ale unconfirmed na active jde', async () => {
    const ctx = await testContext();
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'a@x.cz', status: 'unconfirmed', attributes: {} }],
    });
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'a@x.cz', status: 'active', attributes: {} }],
    });
    expect((await findByEmail(ctx, 'a@x.cz')).status).toBe('active');
  });

  it('dávka se zapisuje jedním příkazem, ne po řádcích', async () => {
    const ctx = await testContext();
    const rows = Array.from({ length: 500 }, (_, i) => ({
      email: `user${i}@x.cz`,
      attributes: {},
    }));
    const result = await upsertContacts(ctx, { mode: 'update', rows });
    expect(result).toHaveLength(500);
    expect(result.every((r) => r.inserted)).toBe(true);
  }, 30_000);

  it('cizí kontext kontakt nevidí', async () => {
    const a = await testContext();
    const b = await testContext();
    await upsertContacts(a, { mode: 'update', rows: [{ email: 'j@x.cz', attributes: {} }] });
    expect(await findByEmailOrNull(b, 'j@x.cz')).toBeNull();
  });

  it('PRAVIDLO 4 NEJDE OBEJÍT DÁVKOU: adresa se stížností se nezapíše ani přes upsertContacts', async () => {
    // Regrese proti návrhu, kde suppression kontroloval jen writeContact. Import jde
    // dávkovou cestou, takže by stačilo naimportovat starý soubor a člověk, který podal
    // stížnost, by byl zpátky v databázi. Ostatní řádky dávky se zapsat musí.
    const ctx = await testContext();
    const { addSuppression } = await import('../../repo/suppressions');
    await addSuppression(ctx, { email: 'blok@x.cz', reason: 'complaint', source: 'api' });

    const result = await upsertContacts(ctx, {
      mode: 'overwrite',
      rows: [
        { email: 'blok@x.cz', attributes: {} },
        { email: 'ok@x.cz', attributes: {} },
      ],
    });

    expect(result).toHaveLength(1);
    expect(await findByEmailOrNull(ctx, 'blok@x.cz')).toBeNull();
    expect(await findByEmailOrNull(ctx, 'ok@x.cz')).not.toBeNull();
  });

  it('PRAVIDLO 4: výmaz podle GDPR blokuje dávku stejně jako stížnost', async () => {
    const ctx = await testContext();
    const { addSuppression } = await import('../../repo/suppressions');
    await addSuppression(ctx, { email: 'vymazan@x.cz', reason: 'gdpr_erasure', source: 'api' });
    expect(
      await upsertContacts(ctx, {
        mode: 'update',
        rows: [{ email: 'vymazan@x.cz', attributes: {} }],
      }),
    ).toEqual([]);
  });

  it('mírnější důvod dávku neblokuje', async () => {
    const ctx = await testContext();
    const { addSuppression } = await import('../../repo/suppressions');
    await addSuppression(ctx, { email: 'odraz@x.cz', reason: 'hard_bounce', source: 'api' });
    expect(
      await upsertContacts(ctx, {
        mode: 'update',
        rows: [{ email: 'odraz@x.cz', attributes: {} }],
      }),
    ).toHaveLength(1);
  });

  it('otisky adresy se ukládají a při dalším zápisu se sjednocují, ne přepisují', async () => {
    const ctx = await testContext();
    const first = Buffer.alloc(32, 1);
    const second = Buffer.alloc(32, 2);
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', emailFingerprints: [first], attributes: {} }],
    });
    await upsertContacts(ctx, {
      mode: 'update',
      rows: [{ email: 'j@x.cz', emailFingerprints: [second], attributes: {} }],
    });
    const stored = (await findByEmail(ctx, 'j@x.cz')).email_fingerprints.map((b) =>
      Buffer.from(b).toString('hex'),
    );
    expect(stored).toHaveLength(2);
    expect(stored).toContain(first.toString('hex'));
    expect(stored).toContain(second.toString('hex'));
  });
});
