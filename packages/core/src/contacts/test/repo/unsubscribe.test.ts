import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerRevokePendingMessages,
  resetRevokePendingMessages,
  type RevokePendingMessagesInput,
} from '../../campaigns-port';
import { registerSubscriptionEmails, resetSubscriptionEmails } from '../../lists/subscribe-service';
import { bulkUnsubscribeFromList, snooze, unsubscribe } from '../../lists/unsubscribe';
import {
  asMigrator,
  createActiveContact,
  createList,
  createSubscription,
  testContext,
} from '../support/db';
import {
  auditActions,
  confirmedSubscription,
  contactStatus,
  lastWebhookEvent,
  latestConsent,
  maybeOne,
  snoozeUntil,
  subscriptionStatus,
  suppressionForOrNull,
} from '../support/phase-c';

const revoke = vi.fn(async (_input: RevokePendingMessagesInput) => ({ revoked: 0 }));

/** Rozloučení po odhlášení. Port se podvrhuje, ať se testuje rozhodnutí, ne outbox. */
let goodbyes: { listId: string; contactId: string }[] = [];

beforeEach(() => {
  revoke.mockClear();
  registerRevokePendingMessages(revoke);
  goodbyes = [];
  registerSubscriptionEmails({
    async sendConfirmation() {},
    async sendWelcome() {},
    async sendGoodbye(input) {
      goodbyes.push({ listId: input.listId, contactId: input.contactId });
    },
    async deliverRequestedItem() {},
  });
});

afterEach(() => {
  resetRevokePendingMessages();
  resetSubscriptionEmails();
});

describe('rozsah odhlášení', () => {
  it('token se seznamem odhlásí jen z toho seznamu a NEZAPÍŠE suppression', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: list.id, reason: 'link' });

    expect(await subscriptionStatus(ctx, contact.id, list.id)).toBe('unsubscribed');
    // Suppression platí pro celý projekt, takže u odhlášení ze seznamu nevzniká.
    expect(await suppressionForOrNull(ctx, 'j@x.cz')).toBeNull();
  });

  it('token bez seznamu odhlásí globálně a suppression zapíše', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: null, reason: 'link' });

    expect(await subscriptionStatus(ctx, contact.id, list.id)).toBe('unsubscribed');
    expect((await suppressionForOrNull(ctx, 'j@x.cz'))?.reason).toBe('global_unsubscribe');
    expect(await contactStatus(ctx, contact.id)).toBe('unsubscribed');
  });

  it('KRITÉRIUM 58: one-click bez seznamu má důvod one_click_unsubscribe', async () => {
    const ctx = await testContext();
    const { contact } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: null, reason: 'one_click' });
    expect((await suppressionForOrNull(ctx, 'j@x.cz'))?.reason).toBe('one_click_unsubscribe');
  });

  it('KRITÉRIUM 79: odhlášení ze seznamu A předá listId A, ne null', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: list.id, reason: 'link' });

    // `tx` je transakce odhlášení a předává se schválně, aby zrušení proběhlo
    // v NÍ. Porovnává se proto podmnožina, ne celý objekt; hlídaná věc je listId.
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ctx.workspaceId,
        contactIds: [contact.id],
        listId: list.id,
        reason: 'unsubscribed',
      }),
    );
  });

  it('KRITÉRIUM 79: globální odhlášení předá listId null EXPLICITNĚ', async () => {
    const ctx = await testContext();
    const { contact } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: null, reason: 'link' });

    const call = revoke.mock.calls.find((c) => c[0].reason === 'unsubscribed')![0];
    // Klíč musí v objektu BÝT, ne chybět. Vynechání by v části 4a znamenalo
    // "zruš všechny čekající zprávy", což je jiný rozsah než ten, který uživatel zvolil.
    expect(Object.keys(call)).toContain('listId');
    expect(call.listId).toBeNull();
  });

  it('pozastavení nemění stav přihlášení, jen nastaví snooze', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await snooze(ctx, { contactId: contact.id, listId: list.id, days: 30 });

    expect(await subscriptionStatus(ctx, contact.id, list.id)).toBe('confirmed');
    expect(await snoozeUntil(ctx, contact.id, list.id)).not.toBeNull();
  });

  it('odhlášení zapíše odvolání souhlasu s rozsahem seznamu', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: list.id, reason: 'link' });

    const consent = await latestConsent(ctx, contact.id, 'email_marketing');
    expect(consent).toMatchObject({ status: 'withdrawn', scope_list_id: list.id });
  });

  it('globální odhlášení zapíše odvolání bez rozsahu', async () => {
    const ctx = await testContext();
    const { contact } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: null, reason: 'link' });

    const consent = await latestConsent(ctx, contact.id, 'email_marketing');
    expect(consent).toMatchObject({ status: 'withdrawn', scope_list_id: null });
  });

  it('námitka podle článku 21 se chová jako globální odhlášení', async () => {
    const ctx = await testContext();
    const { contact } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: null, reason: 'objection' });

    expect((await suppressionForOrNull(ctx, 'j@x.cz'))?.reason).toBe('global_unsubscribe');
    expect((await latestConsent(ctx, contact.id, 'email_marketing'))?.source).toBe('objection');
  });

  it('vyvolá odchozí událost contact.unsubscribed se správným rozsahem', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: list.id, reason: 'link' });

    expect(await lastWebhookEvent(ctx)).toMatchObject({
      type: 'contact.unsubscribed',
      data: { list_id: list.id, scope: 'list' },
    });
  });

  it('zásah správce se v souhlasu pozná od projevu vůle příjemce', async () => {
    // Dřív spadlo všechno kromě one-click a námitky na `preference_center`, takže se
    // ruční odhlášení správcem tvářilo, jako by si o něj řekl sám příjemce.
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await unsubscribe(ctx, { contactId: contact.id, listId: list.id, reason: 'manual' });

    expect((await latestConsent(ctx, contact.id, 'email_marketing'))?.source).toBe('admin');
  });
});

/**
 * Hromadné odhlášení ze seznamu.
 *
 * Testuje se STAV V DATECH, ne návratová hodnota: server, který vrátí „odhlášeno"
 * a řádek v `list_subscriptions` nechá být, je přesně ta vada, kvůli které tenhle
 * blok existuje.
 */
describe('hromadné odhlášení ze seznamu', () => {
  it('opravdu změní stav přihlášení v datech, nejen návratovou hodnotu', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');

    const results = await bulkUnsubscribeFromList(ctx, {
      listId: list.id,
      emails: ['j@x.cz'],
      reason: 'manual',
    });

    expect(results).toEqual([{ index: 0, outcome: 'unsubscribed', contactId: contact.id }]);
    expect(await subscriptionStatus(ctx, contact.id, list.id)).toBe('unsubscribed');
    // Odhlášení ze seznamu nesahá na stav kontaktu ani na blokované adresy, stejně
    // jako jednotlivá cesta.
    expect(await contactStatus(ctx, contact.id)).toBe('active');
    expect(await suppressionForOrNull(ctx, 'j@x.cz')).toBeNull();
  });

  it('kontakt, který v seznamu vůbec není, spočítá jako beze změny a nespadne', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'mimo@x.cz');
    const list = await createList(ctx, { name: 'Newsletter' });

    const results = await bulkUnsubscribeFromList(ctx, {
      listId: list.id,
      emails: ['mimo@x.cz'],
      reason: 'manual',
    });

    expect(results).toEqual([{ index: 0, outcome: 'unchanged', contactId: contact.id }]);
    // Řádek nesmí vzniknout: kontakt v seznamu nikdy nebyl, takže tam nemá co dělat
    // ani jako odhlášený.
    const row = await maybeOne<{ status: string }>(
      `SELECT status FROM list_subscriptions
        WHERE workspace_id = $1 AND contact_id = $2 AND list_id = $3`,
      [ctx.workspaceId, contact.id, list.id],
    );
    expect(row).toBeNull();
  });

  it('kontakt, který je odhlášený už teď, spočítá jako beze změny a nic nepřepíše', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'uz@x.cz');
    const list = await createList(ctx, { name: 'Newsletter' });
    await createSubscription(ctx, {
      contactId: contact.id,
      listId: list.id,
      status: 'unsubscribed',
    });

    const results = await bulkUnsubscribeFromList(ctx, {
      listId: list.id,
      emails: ['uz@x.cz'],
      reason: 'manual',
    });

    expect(results).toEqual([{ index: 0, outcome: 'unchanged', contactId: contact.id }]);
    expect(await subscriptionStatus(ctx, contact.id, list.id)).toBe('unsubscribed');
    // Druhé odhlášení nesmí zapsat druhé odvolání souhlasu: nic se nezměnilo.
    expect(await latestConsent(ctx, contact.id, 'email_marketing')).toBeNull();
  });

  it('neznámou adresu vrátí výsledkem, nikdy ji tiše nepřeskočí', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Newsletter' });

    const results = await bulkUnsubscribeFromList(ctx, {
      listId: list.id,
      emails: ['nikdo@x.cz'],
      reason: 'manual',
    });

    expect(results).toEqual([{ index: 0, outcome: 'unknown_contact', contactId: null }]);
  });

  it('zapíše odvolání souhlasu s rozsahem seznamu a zdrojem správce', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await bulkUnsubscribeFromList(ctx, { listId: list.id, emails: ['j@x.cz'], reason: 'manual' });

    expect(await latestConsent(ctx, contact.id, 'email_marketing')).toMatchObject({
      status: 'withdrawn',
      scope_list_id: list.id,
      source: 'admin',
    });
  });

  it('zapíše jeden auditní záznam za celou dávku', async () => {
    const ctx = await testContext();
    const { list } = await confirmedSubscription(ctx, 'a@x.cz', 'Newsletter');
    await createActiveContact(ctx, 'b@x.cz');

    await bulkUnsubscribeFromList(ctx, {
      listId: list.id,
      emails: ['a@x.cz', 'b@x.cz'],
      reason: 'manual',
    });

    const actions = await auditActions(ctx);
    expect(actions.filter((action) => action === 'contact.bulk_unsubscribed')).toHaveLength(1);
  });

  it('smíšenou dávku vyřídí celou a výsledky drží pořadí vstupu', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'a@x.cz', 'Newsletter');
    const mimo = await createActiveContact(ctx, 'b@x.cz');

    const results = await bulkUnsubscribeFromList(ctx, {
      listId: list.id,
      emails: ['a@x.cz', 'b@x.cz', 'nikdo@x.cz'],
      reason: 'manual',
    });

    expect(results).toEqual([
      { index: 0, outcome: 'unsubscribed', contactId: contact.id },
      { index: 1, outcome: 'unchanged', contactId: mimo.id },
      { index: 2, outcome: 'unknown_contact', contactId: null },
    ]);
    expect(await subscriptionStatus(ctx, contact.id, list.id)).toBe('unsubscribed');
  });
});

/**
 * ROZLOUČENÍ PO ODHLÁŠENÍ. Výchozí stav je vypnuto (rozhodnutí zadavatele
 * z 5. 8. 2026), zapíná se na seznamu a u globálního odhlášení se neposílá
 * vůbec, viz `sendGoodbyeEmail` v `lists/unsubscribe.ts`.
 */
describe('rozloučení po odhlášení', () => {
  it('vypnuté rozloučení nic nepošle', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'r1@x.cz', 'Newsletter R1');
    await unsubscribe(ctx, { contactId: contact.id, listId: list.id, reason: 'link' });
    expect(goodbyes).toEqual([]);
  });

  it('zapnuté rozloučení pošle jeden e-mail za ten seznam', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'r2@x.cz', 'Newsletter R2');
    await asMigrator().query(`UPDATE lists SET send_goodbye = true WHERE id = $1`, [list.id]);

    await unsubscribe(ctx, { contactId: contact.id, listId: list.id, reason: 'link' });

    expect(goodbyes).toEqual([{ listId: list.id, contactId: contact.id }]);
  });

  it('globální odhlášení rozloučení neposílá, není podle čeho vybrat text', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'r3@x.cz', 'Newsletter R3');
    await asMigrator().query(`UPDATE lists SET send_goodbye = true WHERE id = $1`, [list.id]);

    await unsubscribe(ctx, { contactId: contact.id, listId: null, reason: 'link' });

    expect(goodbyes).toEqual([]);
  });
});
