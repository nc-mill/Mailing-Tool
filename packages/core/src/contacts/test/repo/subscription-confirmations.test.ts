import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { hashConfirmationToken } from '../../lists/confirmation';
import * as listsRepo from '../../repo/lists';
import * as subscriptionsRepo from '../../repo/subscriptions';
import { createActiveContact, testContext } from '../support/db';
import { one, setPrivacy } from '../support/phase-c';

let ctx: WorkspaceContext;
let listId: string;
let contactId: string;

type ConfirmationRow = {
  token_hash: Buffer;
  request_ip: string | null;
  request_user_agent: string | null;
};

beforeEach(async () => {
  ctx = await testContext();
  // IP se ukládají jen tam, kde to test vysloveně chce (rozhodnutí R8: výchozí stav je vypnuto).
  await setPrivacy(ctx, { store_ip: true });
  listId = (await listsRepo.create(ctx, { name: 'Newsletter' })).id;
  contactId = (await createActiveContact(ctx, 'jan@example.cz')).id;
});

describe('issueConfirmation', () => {
  it('uloží jen hash, nikdy syrový token', async () => {
    const issued = await subscriptionsRepo.issueConfirmation(ctx, {
      contactId,
      listId,
      ttlHours: 168,
      requestIp: '203.0.113.7',
      requestUserAgent: 'Firefox',
    });

    const row = await one<ConfirmationRow>(
      'SELECT * FROM subscription_confirmations WHERE contact_id = $1',
      [contactId],
    );
    expect(Buffer.from(row.token_hash).equals(hashConfirmationToken(issued.token))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(issued.token);
  });

  it('nové přihlášení zneplatní předchozí nespotřebované tokeny', async () => {
    const first = await subscriptionsRepo.issueConfirmation(ctx, {
      contactId,
      listId,
      ttlHours: 168,
    });
    const second = await subscriptionsRepo.issueConfirmation(ctx, {
      contactId,
      listId,
      ttlHours: 168,
    });

    const stale = await subscriptionsRepo.findConfirmation(ctx, first.token);
    const fresh = await subscriptionsRepo.findConfirmation(ctx, second.token);

    expect(stale?.consumedAt).toBeInstanceOf(Date);
    // Zneplatněný token se pozná od spotřebovaného tím, že nemá consumed_ip a existuje
    // novější řádek pro tutéž dvojici kontakt a seznam.
    expect(stale?.consumedIp).toBeNull();
    expect(fresh?.consumedAt).toBeNull();
  });

  it('respektuje přepínač ukládání IP', async () => {
    await setPrivacy(ctx, { store_ip: false });
    await subscriptionsRepo.issueConfirmation(ctx, {
      contactId,
      listId,
      ttlHours: 168,
      requestIp: '203.0.113.7',
      requestUserAgent: 'Firefox',
    });

    const row = await one<ConfirmationRow>(
      'SELECT * FROM subscription_confirmations WHERE contact_id = $1',
      [contactId],
    );
    expect(row.request_ip).toBeNull();
    // User agent zůstává: bez něj by souhlas nebyl doložitelný vůbec (rozhodnutí R8).
    expect(row.request_user_agent).toBe('Firefox');
  });

  it('IP se uloží, když si to projekt zapnul', async () => {
    await subscriptionsRepo.issueConfirmation(ctx, {
      contactId,
      listId,
      ttlHours: 168,
      requestIp: '203.0.113.7',
      requestUserAgent: 'Firefox',
    });

    const row = await one<ConfirmationRow>(
      'SELECT * FROM subscription_confirmations WHERE contact_id = $1',
      [contactId],
    );
    expect(row.request_ip).toBe('203.0.113.7');
  });
});

describe('consumeConfirmation', () => {
  it('spotřebuje token právě jednou', async () => {
    const issued = await subscriptionsRepo.issueConfirmation(ctx, {
      contactId,
      listId,
      ttlHours: 168,
    });

    const first = await subscriptionsRepo.consumeConfirmation(ctx, issued.token, {
      consumedIp: '203.0.113.7',
      now: new Date(),
    });
    const second = await subscriptionsRepo.consumeConfirmation(ctx, issued.token, {
      consumedIp: '203.0.113.7',
      now: new Date(),
    });

    expect(first?.contactId).toBe(contactId);
    expect(second).toBeNull();
  });

  it('token z cizího projektu nenajde', async () => {
    const other = await testContext();
    const otherList = await listsRepo.create(other, { name: 'Cizí' });
    const otherContact = await createActiveContact(other, 'jan@example.cz');
    const issued = await subscriptionsRepo.issueConfirmation(other, {
      contactId: otherContact.id,
      listId: otherList.id,
      ttlHours: 168,
    });

    expect(await subscriptionsRepo.findConfirmation(ctx, issued.token)).toBeNull();
  });
});
