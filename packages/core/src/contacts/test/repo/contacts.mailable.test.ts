import { describe, expect, it } from 'vitest';
import { listMailableContacts } from '../../repo/contacts';
import { addSuppression } from '../../repo/suppressions';
import {
  createActiveContact,
  createList,
  createSubscription,
  setProcessingRestricted,
  testContext,
} from '../support/db';

describe('výběr mailovatelných kontaktů proti databázi', () => {
  it('KRITÉRIUM 48: active kontakt bez potvrzení na cílovém seznamu se nedostane do publika', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Newsletter', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'pending' });

    const audience = await listMailableContacts(ctx, { listId: list.id });
    expect(audience).toHaveLength(0);
  });

  it('potvrzené přihlášení do publika projde', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Newsletter', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'confirmed' });
    expect(await listMailableContacts(ctx, { listId: list.id })).toHaveLength(1);
  });

  it('KRITÉRIUM 46: kontakt s pozastavením do budoucna v publiku není', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Newsletter', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await createSubscription(ctx, {
      contactId: contact.id,
      listId: list.id,
      status: 'confirmed',
      snoozeUntil: new Date(Date.now() + 86400000),
    });
    expect(await listMailableContacts(ctx, { listId: list.id })).toHaveLength(0);
  });

  it('KRITÉRIUM 70: kontakt s omezeným zpracováním v publiku není nikdy', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await setProcessingRestricted(ctx, contact.id, true);
    expect(await listMailableContacts(ctx, {})).toHaveLength(0);
  });

  it('vrstva 1: suppression vyloučí i kontakt s potvrzeným přihlášením', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Newsletter', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'confirmed' });
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'hard_bounce', source: 'api' });
    expect(await listMailableContacts(ctx, { listId: list.id })).toHaveLength(0);
  });

  it('bez seznamu rozhoduje status: unconfirmed v publiku není, active ano', async () => {
    const ctx = await testContext();
    await createActiveContact(ctx, 'active@x.cz');
    const { writeContact } = await import('../../repo/contacts');
    await writeContact(ctx, { email: 'pending@x.cz', attributes: {} });
    const audience = await listMailableContacts(ctx, {});
    expect(audience.map((c) => c.email)).toEqual(['active@x.cz']);
  });
});
