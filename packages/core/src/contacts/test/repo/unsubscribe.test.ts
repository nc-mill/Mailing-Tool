import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerRevokePendingMessages,
  resetRevokePendingMessages,
  type RevokePendingMessagesInput,
} from '../../campaigns-port';
import { snooze, unsubscribe } from '../../lists/unsubscribe';
import { testContext } from '../support/db';
import {
  confirmedSubscription,
  contactStatus,
  lastWebhookEvent,
  latestConsent,
  snoozeUntil,
  subscriptionStatus,
  suppressionForOrNull,
} from '../support/phase-c';

const revoke = vi.fn(async (_input: RevokePendingMessagesInput) => ({ revoked: 0 }));

beforeEach(() => {
  revoke.mockClear();
  registerRevokePendingMessages(revoke);
});

afterEach(() => {
  resetRevokePendingMessages();
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

    expect(revoke).toHaveBeenCalledWith({
      workspaceId: ctx.workspaceId,
      contactIds: [contact.id],
      listId: list.id,
      reason: 'unsubscribed',
    });
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
});
