import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerRevokePendingMessages,
  resetRevokePendingMessages,
  type RevokePendingMessagesInput,
} from '../../campaigns-port';
import {
  listMailableContacts,
  liftProcessingRestriction,
  restrictProcessing,
} from '../../repo/contacts';
import { createActiveContact, testContext } from '../support/db';
import { auditActions, contactRow, contextWithRole, createFullContact } from '../support/phase-c';

const revoke = vi.fn(async (_input: RevokePendingMessagesInput) => ({ revoked: 0 }));

beforeEach(() => {
  revoke.mockClear();
  registerRevokePendingMessages(revoke);
});

afterEach(() => {
  resetRevokePendingMessages();
});

describe('omezení zpracování', () => {
  it('nastaví příznak a nic nesmaže', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await restrictProcessing(ctx, contact.id);
    const row = await contactRow(ctx, contact.id);
    expect(row['processing_restricted']).toBe(true);
    expect(row['first_name']).not.toBeNull();
    expect(row['deleted_at']).toBeNull();
  });

  it('zruší čekající zprávy s vlastním důvodem', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await restrictProcessing(ctx, contact.id);
    // Důvod se vědomě neslučuje s contact_status_changed: článek 18 je jiný právní
    // důvod než článek 17 a na rozdíl od anonymizace je vratný.
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'processing_restricted', listId: null }),
    );
  });

  it('KRITÉRIUM 70: omezený kontakt nespadne do žádného výběru publika', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await restrictProcessing(ctx, contact.id);
    expect(await listMailableContacts(ctx, {})).toHaveLength(0);
  });

  it('zrušit omezení smí jen správce', async () => {
    const owner = await testContext();
    const contact = await createFullContact(owner, 'j@x.cz');
    await restrictProcessing(owner, contact.id);

    const editor = await contextWithRole(owner, 'editor');
    await expect(liftProcessingRestriction(editor, contact.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('po zrušení omezení se kontakt vrátí do publika', async () => {
    const owner = await testContext();
    const admin = await contextWithRole(owner, 'admin');
    const contact = await createActiveContact(admin, 'j@x.cz');
    await restrictProcessing(admin, contact.id);
    await liftProcessingRestriction(admin, contact.id);
    expect(await listMailableContacts(admin, {})).toHaveLength(1);
  });

  it('obě operace se zapisují do auditu', async () => {
    const owner = await testContext();
    const admin = await contextWithRole(owner, 'admin');
    const contact = await createFullContact(admin, 'j@x.cz');
    await restrictProcessing(admin, contact.id);
    await liftProcessingRestriction(admin, contact.id);
    const actions = await auditActions(admin);
    expect(actions).toContain('contact.processing_restricted');
    expect(actions).toContain('contact.processing_restriction_lifted');
  });

  it('opakované omezení nic nemění a nezruší zprávy podruhé', async () => {
    const ctx = await testContext();
    const contact = await createFullContact(ctx, 'j@x.cz');
    await restrictProcessing(ctx, contact.id);
    revoke.mockClear();
    await restrictProcessing(ctx, contact.id);
    expect(revoke).not.toHaveBeenCalled();
  });
});
