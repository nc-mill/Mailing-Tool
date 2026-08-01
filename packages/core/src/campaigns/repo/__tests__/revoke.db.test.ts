import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedMessages, type TestWorkspace } from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { revokePending } from '../outbox';
import { rawSql } from '../raw-sql';

describe('ruseni cekajicich zprav', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('pending zprava kontaktu se oznaci jako skipped s duvodem', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    const r = await revokePending(ctx.workspace, {
      contactIds: [contactId],
      listId: null,
      reason: 'unsubscribed',
    });
    expect(r.revoked).toBe(1);
    const rows = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; error_code: string }>(
        rawSql(`SELECT status, error_code FROM messages WHERE contact_id = $1`, [contactId]),
      ),
    );
    expect(rows.rows[0]).toMatchObject({ status: 'skipped', error_code: 'unsubscribed' });
  });

  it('claimed zprava se NEMENI, sender ji muze mit prave v ruce', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['claimed'] });
    const r = await revokePending(ctx.workspace, {
      contactIds: [contactId],
      listId: null,
      reason: 'suppressed',
    });
    expect(r.revoked).toBe(0);
  });

  it('listId omezi rozsah jen na kampane s tim unsubscribe_list_id', async () => {
    const seeded = await seedMessages(ctx, {
      statuses: ['pending'],
      twoCampaignsWithDifferentLists: true,
    });
    const r = await revokePending(ctx.workspace, {
      contactIds: [seeded.contactId],
      listId: seeded.listA,
      reason: 'unsubscribed',
    });
    expect(r.revoked).toBe(1);
  });

  it('listId null zrusi vsechny cekajici zpravy kontaktu v projektu', async () => {
    const seeded = await seedMessages(ctx, {
      statuses: ['pending'],
      twoCampaignsWithDifferentLists: true,
    });
    const r = await revokePending(ctx.workspace, {
      contactIds: [seeded.contactId],
      listId: null,
      reason: 'suppressed',
    });
    expect(r.revoked).toBe(2);
  });

  it('vetev pres e-mail funguje, kdyz contact_id neznáme', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    const r = await revokePending(ctx.workspace, {
      emails: [email.toUpperCase()],
      listId: null,
      reason: 'suppressed',
    });
    expect(r.revoked).toBe(1);
  });

  it('zadne casove omezeni: rusi i zpravy ve stare partition', async () => {
    const { contactId } = await seedMessages(ctx, {
      statuses: ['pending'],
      createdMonthsAgo: 3,
    });
    const r = await revokePending(ctx.workspace, {
      contactIds: [contactId],
      listId: null,
      reason: 'suppressed',
    });
    expect(r.revoked).toBe(1);
  });
});
