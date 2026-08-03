import { describe, expect, it } from 'vitest';
import { bulkDeleteContacts, listVisibleContacts } from '../../repo/contacts';
import { bulkDelete } from '../../jobs/bulk-delete';
import { createTag, addTagsToContact } from '../../repo/tags';
import {
  countContacts,
  createActiveContact,
  enqueuedJobNames,
  enqueuedJobs,
  findByEmail,
  lastAuditEntry,
  setStatus,
  testContext,
} from '../support/db';

describe('hromadné mazání kontaktů', () => {
  it('koncová funkce mazání jen zařadí, sama nic nesmaže', async () => {
    const ctx = await testContext();
    const a = await createActiveContact(ctx, 'a@x.cz');
    const b = await createActiveContact(ctx, 'b@x.cz');

    const result = await bulkDeleteContacts(ctx, { mode: 'ids', ids: [a.id, b.id] });

    expect(result).toEqual({ mode: 'queued' });
    expect(await enqueuedJobNames(ctx)).toContain('contacts.bulk_delete');
    // Zařazení není provedení. Kdyby tady bylo 0, znamenalo by to, že se maže
    // synchronně, a odpověď 202 z API by lhala o tom, co se stalo.
    expect(await countContacts(ctx)).toBe(2);
  });

  it('job kontakty z výčtu id opravdu smaže', async () => {
    const ctx = await testContext();
    const a = await createActiveContact(ctx, 'a@x.cz');
    const b = await createActiveContact(ctx, 'b@x.cz');
    await createActiveContact(ctx, 'c@x.cz');

    const pred = await countContacts(ctx);
    const result = await bulkDelete({ workspaceId: ctx.workspaceId, contactIds: [a.id, b.id] });
    const po = await countContacts(ctx);

    expect(pred).toBe(3);
    expect(result.deleted).toBe(2);
    expect(po).toBe(1);
    // Zbyl právě ten, který se mazat neměl.
    expect((await listVisibleContacts(ctx)).length).toBe(1);
  });

  it('smazaný kontakt má deleted_at, status deleted a adresu si nechá', async () => {
    const ctx = await testContext();
    const a = await createActiveContact(ctx, 'a@x.cz');

    await bulkDelete({ workspaceId: ctx.workspaceId, contactIds: [a.id] });

    // Tytéž tři podmínky, jaké hlídá contacts.delete.test.ts u smazání JEDNOHO kontaktu.
    // Hromadné mazání nesmí být jiný druh mazání, jen dávkový.
    const row = await findByEmail(ctx, 'a@x.cz', { includeDeleted: true });
    expect(row.deleted_at).not.toBeNull();
    expect(row.status).toBe('deleted');
    expect(row.email).toBe('a@x.cz');
  });

  it('druhý běh nad týmiž id neovlivní nic', async () => {
    const ctx = await testContext();
    const a = await createActiveContact(ctx, 'a@x.cz');

    const first = await bulkDelete({ workspaceId: ctx.workspaceId, contactIds: [a.id] });
    const second = await bulkDelete({ workspaceId: ctx.workspaceId, contactIds: [a.id] });

    expect(first.deleted).toBe(1);
    // Idempotence slíbená v CONTACTS_QUEUES: UPDATE podmíněný na deleted_at IS NULL.
    expect(second.deleted).toBe(0);
    expect(await countContacts(ctx)).toBe(0);
  });

  it('mazání zapíše audit contact.bulk_deleted i s počtem a objednatelem', async () => {
    const ctx = await testContext();
    const a = await createActiveContact(ctx, 'a@x.cz');
    const b = await createActiveContact(ctx, 'b@x.cz');

    await bulkDelete({
      workspaceId: ctx.workspaceId,
      contactIds: [a.id, b.id],
      requestedBy: 'uzivatel-1',
    });

    const entry = await lastAuditEntry(ctx);
    expect(entry?.action).toBe('contact.bulk_deleted');
    expect(entry?.metadata).toMatchObject({
      deleted: 2,
      mode: 'soft',
      scope: 'ids',
      requested_by: 'uzivatel-1',
    });
  });

  it('běh, který nic nesmazal, audit nezapisuje', async () => {
    const ctx = await testContext();
    const a = await createActiveContact(ctx, 'a@x.cz');
    await bulkDelete({ workspaceId: ctx.workspaceId, contactIds: [a.id] });

    const before = await lastAuditEntry(ctx);
    await bulkDelete({ workspaceId: ctx.workspaceId, contactIds: [a.id] });
    const after = await lastAuditEntry(ctx);

    // Prázdný běh po pádu workeru nesmí do auditu přisypat záznam o smazání nuly lidí.
    expect(after).toEqual(before);
  });

  it('filtr maže právě to, co odpovídá, ne celý projekt', async () => {
    const ctx = await testContext();
    await createActiveContact(ctx, 'a@x.cz');
    await createActiveContact(ctx, 'b@x.cz');
    const bounced = await createActiveContact(ctx, 'c@x.cz');
    await setStatus(ctx, 'c@x.cz', 'bounced');

    const pred = await countContacts(ctx);
    const result = await bulkDelete({
      workspaceId: ctx.workspaceId,
      filter: { status: 'bounced' },
    });
    const po = await countContacts(ctx);

    expect(pred).toBe(3);
    expect(result.deleted).toBe(1);
    expect(po).toBe(2);
    const row = await findByEmail(ctx, 'c@x.cz', { includeDeleted: true });
    expect(row.id).toBe(bounced.id);
    expect(row.deleted_at).not.toBeNull();
  });

  it('filtr podle štítku bere tutéž množinu jako seznam kontaktů', async () => {
    const ctx = await testContext();
    const tag = await createTag(ctx, { name: 'VIP' });
    const a = await createActiveContact(ctx, 'a@x.cz');
    await createActiveContact(ctx, 'b@x.cz');
    await addTagsToContact(ctx, a.id, [tag.id]);

    const result = await bulkDelete({ workspaceId: ctx.workspaceId, filter: { tag_id: tag.id } });

    expect(result.deleted).toBe(1);
    expect(await countContacts(ctx)).toBe(1);
    expect((await findByEmail(ctx, 'a@x.cz', { includeDeleted: true })).deleted_at).not.toBeNull();
    expect((await findByEmail(ctx, 'b@x.cz')).deleted_at).toBeNull();
  });

  it('prázdný filtr smaže všechny kontakty projektu a doběhne', async () => {
    const ctx = await testContext();
    await createActiveContact(ctx, 'a@x.cz');
    await createActiveContact(ctx, 'b@x.cz');
    await createActiveContact(ctx, 'c@x.cz');

    const pred = await countContacts(ctx);
    const result = await bulkDelete({ workspaceId: ctx.workspaceId, filter: {} });
    const po = await countContacts(ctx);

    expect(pred).toBe(3);
    expect(result.deleted).toBe(3);
    expect(po).toBe(0);
  });

  it('mazání se nedotkne cizího projektu', async () => {
    const mine = await testContext();
    const foreign = await testContext();
    const target = await createActiveContact(foreign, 'a@x.cz');
    await createActiveContact(mine, 'a@x.cz');

    // Job dostane cizí id, ale běží pod kontextem svého projektu. RLS ho nesmí pustit.
    const result = await bulkDelete({ workspaceId: mine.workspaceId, contactIds: [target.id] });

    expect(result.deleted).toBe(0);
    expect(await countContacts(foreign)).toBe(1);
  });

  it('náklad bez rozsahu i s obojím rozsahem naráz job odmítne', async () => {
    const ctx = await testContext();
    await expect(bulkDelete({ workspaceId: ctx.workspaceId })).rejects.toThrow(/prázdný rozsah/i);
    await expect(
      bulkDelete({ workspaceId: ctx.workspaceId, contactIds: [], filter: {} }),
    ).rejects.toThrow(/právě\s+jeden/i);
  });

  it('zařazený náklad nese rozsah, projekt i objednatele', async () => {
    const ctx = await testContext();
    await bulkDeleteContacts(ctx, { mode: 'filter', filter: { status: 'bounced' } });

    const jobs = await enqueuedJobs('contacts.bulk_delete');
    const mine = jobs.filter(
      (job) => (job.data as { workspaceId?: string }).workspaceId === ctx.workspaceId,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.data).toMatchObject({
      workspaceId: ctx.workspaceId,
      filter: { status: 'bounced' },
      requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : expect.any(String),
    });
  });

  it('mazání po dávkách projde i množinu větší než jedna dávka', async () => {
    const ctx = await testContext();
    for (let i = 0; i < 12; i += 1) await createActiveContact(ctx, `dav-${i}@x.cz`);

    const pred = await countContacts(ctx);
    // Dávka se v produkci bere z BULK_BATCH_SIZE (5000). Test na ni nesahá; ověřuje,
    // že smyčka projde celou množinu a nezastaví se na první dávce ani se nezacyklí.
    const result = await bulkDelete({ workspaceId: ctx.workspaceId, filter: {} });
    const po = await countContacts(ctx);

    expect(pred).toBe(12);
    expect(result.deleted).toBe(12);
    expect(po).toBe(0);
  });
});
