import { describe, expect, it } from 'vitest';
import { confirmPendingSubscriptions } from '../../lists/confirm-pending';
import { subscribeToList } from '../../lists/subscribe-service';
import { unsubscribe } from '../../lists/unsubscribe';
import { confirmContactManually } from '../../repo/contact-confirm';
import { findEffectiveConsent, recordConsent } from '../../repo/consents';
import { listMailableContacts } from '../../repo/contacts';
import * as listsRepo from '../../repo/lists';
import { addSuppression } from '../../repo/suppressions';
import { asMigrator, createActiveContact, testContext } from '../support/db';
import type { WorkspaceContext } from '../../../identity/types';

/**
 * PROTI SKUTEČNÉ DATABÁZI, ne nad vymyšlenými daty.
 *
 * Vada, kterou tenhle soubor hlídá, přežila právě proto, že se stav přihlášení
 * ověřoval nad čistou funkcí s ručně dosazeným vstupem. Nad databází se hned vidí,
 * co systém o souhlasu doopravdy VÍ: ruční potvrzení kontaktu zapíše udělený souhlas
 * a hned nato ho přidání do seznamu s dvoufázovým potvrzením zahodilo a založilo
 * přihlášení jako `pending`. Potvrzovací e-mail se neposílal, takže z toho nevedla
 * cesta ven a kampaň na seznam se třemi lidmi hlásila publikum nula.
 */

async function statusOf(
  ctx: WorkspaceContext,
  contactId: string,
  listId: string,
): Promise<string | null> {
  const { rows } = await asMigrator().query<{ status: string }>(
    `SELECT status FROM list_subscriptions
      WHERE workspace_id = $1 AND contact_id = $2 AND list_id = $3`,
    [ctx.workspaceId, contactId, listId],
  );
  return rows[0]?.status ?? null;
}

describe('přihlášení do seznamu se řídí tím, co víme o souhlasu', () => {
  it('kontakt s doloženým souhlasem skončí na double opt-in seznamu rovnou potvrzený', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'ma-souhlas@x.cz');

    // Přesně to, co dělá ruční potvrzení kontaktu v rozhraní: udělený souhlas
    // pro celý projekt se zdrojem `admin`.
    await confirmContactManually(ctx, contact.id);

    const result = await subscribeToList(ctx, {
      listId: list.id,
      email: 'ma-souhlas@x.cz',
      source: 'manual',
    });

    expect(result.outcome).toBe('confirmed');
    expect(await statusOf(ctx, contact.id, list.id)).toBe('confirmed');
    // A hlavně: kampaň na ten seznam ho doopravdy uvidí. Tohle je ta vada.
    expect(await listMailableContacts(ctx, { listId: list.id })).toHaveLength(1);
  }, 30_000);

  it('kontakt bez souhlasu zůstává čekající, tam se nic nemění', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'bez-souhlasu@x.cz');

    const result = await subscribeToList(ctx, {
      listId: list.id,
      email: 'bez-souhlasu@x.cz',
      source: 'manual',
    });

    expect(result.outcome).toBe('confirmation_sent');
    expect(await statusOf(ctx, contact.id, list.id)).toBe('pending');
  }, 30_000);

  it('odhlášený se přes starý souhlas nevrátí, i kdyby souhlas v evidenci zůstal', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'odhlaseny@x.cz');
    await confirmContactManually(ctx, contact.id);
    await subscribeToList(ctx, { listId: list.id, email: 'odhlaseny@x.cz', source: 'manual' });
    expect(await statusOf(ctx, contact.id, list.id)).toBe('confirmed');

    await unsubscribe(ctx, { contactId: contact.id, listId: list.id, reason: 'link' });
    expect(await statusOf(ctx, contact.id, list.id)).toBe('unsubscribed');

    /*
     * Odhlášení ze seznamu odvolá souhlas pro tenhle seznam, takže by ho nenašel už
     * `findEffectiveConsent`. Souhlas se sem přesto zapisuje ZNOVU, aby test dokazoval
     * to podstatné: i s platným souhlasem v evidenci se odhlášený vrací jen přes
     * `pending`. Zámek na odhlášení je ve stavovém automatu, ne v evidenci souhlasu,
     * a nesmí na ní záviset.
     */
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'admin',
    });
    expect(await findEffectiveConsent(ctx, { contactId: contact.id, listId: list.id })).not.toBe(
      null,
    );

    await subscribeToList(ctx, { listId: list.id, email: 'odhlaseny@x.cz', source: 'manual' });
    expect(await statusOf(ctx, contact.id, list.id)).toBe('pending');
  }, 30_000);

  it('souhlas pro CIZÍ seznam na tenhle seznam nedosáhne', async () => {
    const ctx = await testContext();
    const cilovy = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    const cizi = await listsRepo.create(ctx, { name: 'VIP', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'cizi-rozsah@x.cz');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: cizi.id,
      source: 'admin',
    });

    await subscribeToList(ctx, { listId: cilovy.id, email: 'cizi-rozsah@x.cz', source: 'manual' });
    expect(await statusOf(ctx, contact.id, cilovy.id)).toBe('pending');
  }, 30_000);

  it('odvolaný souhlas neplatí, i když mu předcházel udělený', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'odvolany@x.cz');
    const zaklad = { contactId: contact.id, purpose: 'email_marketing' as const };
    await recordConsent(ctx, {
      ...zaklad,
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'admin',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await recordConsent(ctx, {
      ...zaklad,
      status: 'withdrawn',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'admin',
      occurredAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    expect(await findEffectiveConsent(ctx, { contactId: contact.id, listId: list.id })).toBe(null);
    await subscribeToList(ctx, { listId: list.id, email: 'odvolany@x.cz', source: 'manual' });
    expect(await statusOf(ctx, contact.id, list.id)).toBe('pending');
  }, 30_000);

  it('zablokovaná adresa zkratku zavírá, i s doloženým souhlasem', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'blokovany@x.cz');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'admin',
    });
    await addSuppression(ctx, { email: 'blokovany@x.cz', reason: 'hard_bounce', source: 'system' });

    await subscribeToList(ctx, { listId: list.id, email: 'blokovany@x.cz', source: 'manual' });
    // Blokovaná adresa se do seznamu nedostane jako potvrzená, ať už skončí kdekoliv.
    expect(await statusOf(ctx, contact.id, list.id)).not.toBe('confirmed');
  }, 30_000);
});

describe('hromadné potvrzení čekajících přihlášení', () => {
  it('potvrdí čekající a kampaň je pak doopravdy vidí', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    for (const email of ['a@x.cz', 'b@x.cz', 'c@x.cz']) {
      await createActiveContact(ctx, email);
      await subscribeToList(ctx, { listId: list.id, email, source: 'manual' });
    }
    expect(await listsRepo.stats(ctx, list.id)).toMatchObject({ pending: 3, confirmed: 0 });
    expect(await listMailableContacts(ctx, { listId: list.id })).toHaveLength(0);

    const result = await confirmPendingSubscriptions(ctx, list.id);

    expect(result).toEqual({ pending: 3, confirmed: 3, skipped: 0 });
    expect(await listsRepo.stats(ctx, list.id)).toMatchObject({ pending: 0, confirmed: 3 });
    // Počet na obrazovce a počet příjemců musí sedět, jinak je oprava k ničemu.
    expect(await listMailableContacts(ctx, { listId: list.id })).toHaveLength(3);
  }, 30_000);

  /*
   * Blokace se schválně zakládá důvodem `manual`. Stížnost (`complaint`) totiž přihlášení
   * sama překlopí na `complained`, takže by se do čekajících vůbec nedostalo a test by
   * ochranu neprověřil, jen by využil cizí kaskádu. Ruční blokace stav přihlášení nemění,
   * takže řádek zůstane `pending` a musí ho odmítnout právě tahle funkce.
   */
  it('vynechá zablokovanou adresu a řekne o tom', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    await createActiveContact(ctx, 'ciste@x.cz');
    await subscribeToList(ctx, { listId: list.id, email: 'ciste@x.cz', source: 'manual' });
    const blokovany = await createActiveContact(ctx, 'blok@x.cz');
    await subscribeToList(ctx, { listId: list.id, email: 'blok@x.cz', source: 'manual' });
    await addSuppression(ctx, { email: 'blok@x.cz', reason: 'manual', source: 'admin' });

    const result = await confirmPendingSubscriptions(ctx, list.id);

    expect(result).toEqual({ pending: 2, confirmed: 1, skipped: 1 });
    expect(await statusOf(ctx, blokovany.id, list.id)).toBe('pending');
  }, 30_000);

  it('zapíše souhlas se zdrojem admin a rozsahem toho seznamu', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Novinky', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'doklad@x.cz');
    await subscribeToList(ctx, { listId: list.id, email: 'doklad@x.cz', source: 'manual' });

    await confirmPendingSubscriptions(ctx, list.id);

    const proof = await findEffectiveConsent(ctx, { contactId: contact.id, listId: list.id });
    expect(proof).toMatchObject({ scopeListId: list.id, source: 'admin' });
  }, 30_000);

  it('u seznamu bez čekajících nic nedělá a nespadne', async () => {
    const ctx = await testContext();
    const list = await listsRepo.create(ctx, { name: 'Prázdný', optIn: 'double' });
    expect(await confirmPendingSubscriptions(ctx, list.id)).toEqual({
      pending: 0,
      confirmed: 0,
      skipped: 0,
    });
  }, 30_000);
});
