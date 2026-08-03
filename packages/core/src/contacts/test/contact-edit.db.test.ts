import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors/api-error';
import { cancelSnooze, snooze } from '../lists/unsubscribe';
import { previewName, replaceContact } from '../repo/contact-edit';
import { patchContact, upsertContactFromApi } from '../repo/contacts-api';
import { writeContact } from '../repo/contacts';
import { getContactById } from '../repo/contacts-query';
import { addSuppression } from '../repo/suppressions';
import {
  asMigrator,
  createList,
  createSubscription,
  findByEmail,
  lastAuditEntry,
  testContext,
} from './support/db';

/**
 * Ruční úprava kontaktu z obrazovky, náhled oslovení a zrušení pozastavení odběru.
 *
 * Tenhle soubor je tu proto, že všechny tři věci se zvenčí těžko odlišují od funkčního
 * stavu. Uložení formuláře vrátí 200 i tehdy, když se hodnota nezapsala; náhled ukáže
 * oslovení i tehdy, když se počítá jinak než zápis; a tlačítko „Zrušit pauzu" vypadá
 * stejně, ať pauzu ruší, nebo ne. Tvrdí se proto jen o tom, co je v databázi.
 */

async function contactWith(
  ctx: Awaited<ReturnType<typeof testContext>>,
  input: { email: string; firstName?: string | null; lastName?: string | null },
): Promise<string> {
  const written = await writeContact(ctx, {
    email: input.email,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    attributes: {},
  });
  if (written.rejected !== null) throw new Error('kontakt byl potlačený');
  return written.id;
}

describe('replaceContact, úprava kontaktu z formuláře', () => {
  /**
   * NEJDŮLEŽITĚJŠÍ TEST TOHOHLE SOUBORU. Tohle je přesně ta vada, kvůli které editační
   * formulář nemohl jet přes PATCH: v režimu `update` SQL upsert prázdnou hodnotu
   * zahodí a nechá starou, takže „smazal jsem příjmení a uložil" vrátí 200 a nic nezmění.
   */
  it('prázdné příjmení hodnotu SKUTEČNĚ smaže, na rozdíl od PATCH', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, {
      email: 'petr.spatne@example.cz',
      firstName: 'Petr',
      lastName: 'Novák',
    });

    // Nejdřív doklad, že stará cesta to neuměla. Kdyby to PATCH uměl, nová trasa
    // by nebyla potřeba a tenhle test by na to upozornil.
    await patchContact(ctx, id, { last_name: null });
    expect((await findByEmail(ctx, 'petr.spatne@example.cz')).last_name).toBe('Novák');

    await replaceContact(ctx, id, { first_name: 'Petr', last_name: null });
    expect((await findByEmail(ctx, 'petr.spatne@example.cz')).last_name).toBeNull();
  });

  it('změna jména přepočítá oslovení, ne jen sloupec se jménem', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'j@example.cz', firstName: 'Jana' });
    expect((await findByEmail(ctx, 'j@example.cz')).greeting).toContain('Jano');

    await replaceContact(ctx, id, { first_name: 'Ondřej' });

    const row = await findByEmail(ctx, 'j@example.cz');
    expect(row.first_name).toBe('Ondřej');
    expect(row.greeting).toContain('Ondřeji');
  });

  it('adresu nemění ani když ji někdo do těla propašuje', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'klic@example.cz', firstName: 'Petr' });

    await replaceContact(ctx, id, {
      first_name: 'Petr',
      ...({ email: 'jiny@example.cz' } as Record<string, unknown>),
    });

    expect(await findByEmail(ctx, 'klic@example.cz')).not.toBeNull();
    expect((await getContactById(ctx, id))?.email).toBe('klic@example.cz');
  });

  it('štítek, který uživatel odškrtl, se odebere, a nový se přidá', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'stitky@example.cz', firstName: 'Petr' });

    await replaceContact(ctx, id, { tags: ['Brno', 'VIP'] });
    expect((await getContactById(ctx, id))?.tags.map((tag) => tag.name).toSorted()).toEqual([
      'Brno',
      'VIP',
    ]);

    await replaceContact(ctx, id, { tags: ['VIP'] });
    expect((await getContactById(ctx, id))?.tags.map((tag) => tag.name)).toEqual(['VIP']);
  });

  it('prázdná hodnota vlastního pole klíč z atributů odstraní, nenechá ho prázdný', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'pole@example.cz', firstName: 'Petr' });

    await replaceContact(ctx, id, { attributes: { city: 'Brno' } });
    expect((await findByEmail(ctx, 'pole@example.cz')).attributes).toMatchObject({ city: 'Brno' });

    await replaceContact(ctx, id, { attributes: { city: null } });
    expect((await findByEmail(ctx, 'pole@example.cz')).attributes).not.toHaveProperty('city');
  });

  it('smazaný kontakt vrací null, ne tichý zápis do nikam', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'pryc@example.cz', firstName: 'Petr' });
    await asMigrator().query(
      `UPDATE contacts SET deleted_at = now(), status = 'deleted' WHERE id = $1`,
      [id],
    );

    expect(await replaceContact(ctx, id, { first_name: 'Jiný' })).toBeNull();
  });

  /**
   * Pravidlo 3 ze 4.1.2 části 2 platí i tady. Kdyby ho editační trasa obcházela, stačilo
   * by odhlášený kontakt „upravit" a byl by zpátky v rozesílce.
   */
  it('odhlášený kontakt se úpravou nepovýší zpátky na aktivní', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'odhlaseny@example.cz', firstName: 'Petr' });
    await asMigrator().query(`UPDATE contacts SET status = 'unsubscribed' WHERE id = $1`, [id]);

    await replaceContact(ctx, id, { first_name: 'Petr', last_name: 'Nový' });

    expect((await findByEmail(ctx, 'odhlaseny@example.cz')).status).toBe('unsubscribed');
  });
});

/**
 * Ruční založení kontaktu z formuláře. Jde přes `POST /contacts`, tedy přes
 * `upsertContactFromApi`, což je TÁŽ funkce, kterou používá import a webhook.
 *
 * Testuje se to proto, že „formulář si to udělá po svém" je přesně ta zkratka, kterou
 * by šlo zadními vrátky obejít dvojí opt-in i seznam blokovaných adres. Tvrdí se tu
 * o vlastnostech, na kterých rozhraní staví: výchozí stav, zdroj a odmítnutí adresy
 * po stížnosti.
 */
describe('ruční založení kontaktu', () => {
  it('vzniká jako unconfirmed, ne active', async () => {
    const ctx = await testContext();
    const { contact, created } = await upsertContactFromApi(ctx, {
      email: 'rucne@example.cz',
      first_name: 'Petr',
      source: 'manual',
    });

    expect(created).toBe(true);
    expect(contact.status).toBe('unconfirmed');
    expect((await findByEmail(ctx, 'rucne@example.cz')).status).toBe('unconfirmed');
  });

  it('nese zdroj manual, ne api', async () => {
    const ctx = await testContext();
    const { contact } = await upsertContactFromApi(ctx, {
      email: 'zdroj@example.cz',
      first_name: 'Petr',
      source: 'manual',
    });
    expect(contact.source).toBe('manual');
  });

  it('přihlášení do seznamu zakládá jako pending, ne confirmed', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Ruční' });
    const { contact } = await upsertContactFromApi(ctx, {
      email: 'seznam@example.cz',
      first_name: 'Petr',
      source: 'manual',
      lists: [{ list_id: list.id }],
    });

    const { rows } = await asMigrator().query<{ status: string }>(
      `SELECT status FROM list_subscriptions WHERE contact_id = $1 AND list_id = $2`,
      [contact.id, list.id],
    );
    expect(rows[0]?.status).toBe('pending');
  });

  /**
   * Pravidlo 4 ze 4.1.2 části 2. Kdyby formulář tuhle bránu minul, byl by z ručního
   * založení nejjednodušší způsob, jak vrátit do databáze člověka, který podal stížnost.
   */
  it('adresu po stížnosti odmítne stejně jako import', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, {
      email: 'stiznost@example.cz',
      reason: 'complaint',
      source: 'test',
    });

    await expect(
      upsertContactFromApi(ctx, {
        email: 'stiznost@example.cz',
        first_name: 'Petr',
        source: 'manual',
      }),
    ).rejects.toThrow(ApiError);

    expect(
      await asMigrator()
        .query(`SELECT 1 FROM contacts WHERE workspace_id = $1 AND email = $2`, [
          ctx.workspaceId,
          'stiznost@example.cz',
        ])
        .then((result) => result.rows.length),
    ).toBe(0);
  });
});

/**
 * Zápis, který neuvádí jméno, nesmí zahodit oslovení.
 *
 * NALEZENO V PROHLÍŽEČI NA ŽIVÉ DATABÁZI, ne odvozeno z kódu. Kontakt „Jana Nováková"
 * s oslovením „Dobrý den, Jano" se po přihlášení do seznamu z detailu kontaktu oslovoval
 * „Dobrý den", a ve sloupci `first_name` přitom pořád stálo „Jana".
 *
 * Příčina byla v `upsertRows`: sloupce `first_name` a `last_name` mají proti přepsání
 * prázdnou hodnotou ochranu (`coalesce(nullif(...))`), odvozené sloupce (`first_name_vocative`,
 * `greeting`, `vocative_confidence`) ji neměly a přepisovaly se vždycky. Týkalo se to
 * každé cesty, která přihlašuje podle adresy: veřejného formuláře, stránky předvoleb
 * i opakovaného odeslání potvrzení.
 */
describe('oslovení přežije zápis, který jméno neuvádí', () => {
  it('zápis jen s adresou nechá jméno i oslovení být', async () => {
    const ctx = await testContext();
    await writeContact(ctx, {
      email: 'jana@example.cz',
      firstName: 'Jana',
      lastName: 'Nováková',
      attributes: {},
    });
    expect((await findByEmail(ctx, 'jana@example.cz')).greeting).toBe('Dobrý den, Jano');

    // Přesně to, co dělá subscribe(): zapíše kontakt podle adresy, jméno nezná.
    await writeContact(ctx, { email: 'jana@example.cz', attributes: {} });

    const row = await findByEmail(ctx, 'jana@example.cz');
    expect(row.first_name).toBe('Jana');
    expect(row.greeting).toBe('Dobrý den, Jano');
    expect(row.greeting_neutral).toBe('Dobrý den');
  });

  it('v režimu overwrite prázdné jméno oslovení naopak smazat MUSÍ', async () => {
    const ctx = await testContext();
    await writeContact(ctx, {
      email: 'smazat@example.cz',
      firstName: 'Jana',
      lastName: 'Nováková',
      attributes: {},
    });

    await writeContact(ctx, { email: 'smazat@example.cz', attributes: {}, mode: 'overwrite' });

    const row = await findByEmail(ctx, 'smazat@example.cz');
    expect(row.first_name).toBeNull();
    expect(row.greeting).toBe('Dobrý den');
  });

  it('zápis, který jméno uvádí, oslovení dál přepisuje', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'zmena@example.cz', firstName: 'Jana', attributes: {} });
    await writeContact(ctx, { email: 'zmena@example.cz', firstName: 'Ondřej', attributes: {} });

    expect((await findByEmail(ctx, 'zmena@example.cz')).greeting).toBe('Dobrý den, Ondřeji');
  });
});

describe('previewName, náhled oslovení ve formuláři', () => {
  /**
   * Náhled a zápis jsou dvě implementace téhož pravidla, stejně jako `listMailableContacts`
   * je druhou podobou brány z `mailable.ts`. Tenhle test je jediný důvod, proč se tomu dá
   * věřit: kdyby se cesty rozešly, formulář by uživateli ukazoval jedno oslovení a do
   * kampaně by odešlo jiné, a nic by nespadlo.
   */
  it.each([
    ['Petr', 'Novák'],
    ['Jana', 'Nováková'],
    ['Ondřej', 'Dvořák'],
    ['Tomáš', 'Svoboda'],
    ['Lucie', 'Černá'],
  ])('náhled pro %s %s sedí na oslovení, které zápis uloží', async (first, last) => {
    const ctx = await testContext();
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.cz`;

    const preview = await previewName(ctx, { firstName: first, lastName: last });
    await contactWith(ctx, { email, firstName: first, lastName: last });

    const stored = await findByEmail(ctx, email);
    expect(preview.greeting).toBe(stored.greeting);
    expect(preview.greetingNeutral).toBe(stored.greeting_neutral);
  });

  it('sedí i po změně rodu, kterou uživatel udělá ručně', async () => {
    const ctx = await testContext();
    const preview = await previewName(ctx, {
      firstName: 'René',
      lastName: 'Novák',
      gender: 'male',
    });

    await writeContact(ctx, {
      email: 'rene@example.cz',
      firstName: 'René',
      lastName: 'Novák',
      gender: 'male',
      attributes: {},
    });

    expect(preview.greeting).toBe((await findByEmail(ctx, 'rene@example.cz')).greeting);
  });

  it('nic nezapisuje', async () => {
    const ctx = await testContext();
    const { rows: before } = await asMigrator().query<{ total: string }>(
      `SELECT count(*) AS total FROM contacts WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );

    await previewName(ctx, { firstName: 'Petr', lastName: 'Novák' });

    const { rows: after } = await asMigrator().query<{ total: string }>(
      `SELECT count(*) AS total FROM contacts WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );
    expect(after[0]!.total).toBe(before[0]!.total);
  });
});

describe('cancelSnooze, protějšek pozastavení odběru', () => {
  it('zruší pauzu ve všech seznamech kontaktu a řekne kolik jich bylo', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'pauza@example.cz', firstName: 'Petr' });
    const listA = await createList(ctx, { name: 'A' });
    const listB = await createList(ctx, { name: 'B' });
    await createSubscription(ctx, { contactId: id, listId: listA.id, status: 'confirmed' });
    await createSubscription(ctx, { contactId: id, listId: listB.id, status: 'confirmed' });
    await snooze(ctx, { contactId: id, listId: null, days: 90 });

    const result = await cancelSnooze(ctx, { contactId: id, listId: null });

    expect(result.cleared).toBe(2);
    const { rows } = await asMigrator().query<{ snooze_until: Date | null }>(
      `SELECT snooze_until FROM list_subscriptions WHERE contact_id = $1`,
      [id],
    );
    expect(rows.every((row) => row.snooze_until === null)).toBe(true);
  });

  it('s uvedeným seznamem se ostatních pauz nedotkne', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'pauza2@example.cz', firstName: 'Petr' });
    const listA = await createList(ctx, { name: 'A2' });
    const listB = await createList(ctx, { name: 'B2' });
    await createSubscription(ctx, { contactId: id, listId: listA.id, status: 'confirmed' });
    await createSubscription(ctx, { contactId: id, listId: listB.id, status: 'confirmed' });
    await snooze(ctx, { contactId: id, listId: null, days: 30 });

    await cancelSnooze(ctx, { contactId: id, listId: listA.id });

    const { rows } = await asMigrator().query<{ list_id: string; snooze_until: Date | null }>(
      `SELECT list_id, snooze_until FROM list_subscriptions WHERE contact_id = $1`,
      [id],
    );
    expect(rows.find((row) => row.list_id === listA.id)?.snooze_until).toBeNull();
    expect(rows.find((row) => row.list_id === listB.id)?.snooze_until).not.toBeNull();
  });

  /** Bez pauzy se nemá co zrušit a nesmí se kvůli tomu psát do auditu. */
  it('bez pauzy vrací nulu a audit nešpiní', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'bezpauzy@example.cz', firstName: 'Petr' });
    const list = await createList(ctx, { name: 'C' });
    await createSubscription(ctx, { contactId: id, listId: list.id, status: 'confirmed' });

    const before = await lastAuditEntry(ctx);
    const result = await cancelSnooze(ctx, { contactId: id, listId: null });

    expect(result.cleared).toBe(0);
    expect(await lastAuditEntry(ctx)).toEqual(before);
  });

  it('zrušení pauzy se zapíše do auditu', async () => {
    const ctx = await testContext();
    const id = await contactWith(ctx, { email: 'audit@example.cz', firstName: 'Petr' });
    const list = await createList(ctx, { name: 'D' });
    await createSubscription(ctx, { contactId: id, listId: list.id, status: 'confirmed' });
    await snooze(ctx, { contactId: id, listId: null, days: 60 });

    await cancelSnooze(ctx, { contactId: id, listId: null });

    const entry = await lastAuditEntry(ctx);
    expect(entry?.action).toBe('contact.snooze_cancelled');
    expect(entry?.target_id).toBe(id);
  });
});
