import { describe, expect, it } from 'vitest';
import {
  addTagsToContact,
  bulkTagContacts,
  createTag,
  mergeTags,
  removeTagFromContact,
  renameTag,
} from '../../repo/tags';
import { bulkTag } from '../../jobs/bulk-tag';
import {
  contactHasTag,
  countContactTags,
  createActiveContact,
  enqueuedJobNames,
  tagExists,
  testContext,
} from '../support/db';

describe('štítky', () => {
  it('jméno je unikátní bez ohledu na velikost písmen', async () => {
    const ctx = await testContext();
    await createTag(ctx, { name: 'VIP' });
    await expect(createTag(ctx, { name: 'vip' })).rejects.toMatchObject({
      code: 'already_exists',
    });
  });

  it('přidání štítku dvakrát nevytvoří dva řádky', async () => {
    const ctx = await testContext();
    const tag = await createTag(ctx, { name: 'VIP' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await addTagsToContact(ctx, contact.id, [tag.id]);
    await addTagsToContact(ctx, contact.id, [tag.id]);
    expect(await countContactTags(ctx, contact.id)).toBe(1);
  });

  it('odebrání štítku, který kontakt nemá, není chyba', async () => {
    const ctx = await testContext();
    const tag = await createTag(ctx, { name: 'VIP' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await expect(removeTagFromContact(ctx, contact.id, tag.id)).resolves.not.toThrow();
  });

  it('limit 500 štítků na projekt', async () => {
    const ctx = await testContext();
    for (let i = 0; i < 500; i += 1) await createTag(ctx, { name: `tag${i}` });
    await expect(createTag(ctx, { name: 'over' })).rejects.toMatchObject({
      code: 'too_many_items',
    });
  }, 120_000);

  it('limit 50 štítků na kontakt', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    const tags: string[] = [];
    for (let i = 0; i < 50; i += 1) tags.push((await createTag(ctx, { name: `t${i}` })).id);
    await addTagsToContact(ctx, contact.id, tags);
    const extra = await createTag(ctx, { name: 'extra' });
    await expect(addTagsToContact(ctx, contact.id, [extra.id])).rejects.toMatchObject({
      code: 'too_many_items',
    });
  }, 60_000);

  it('přejmenování je čistá operace nad jménem, nic se nekopíruje', async () => {
    const ctx = await testContext();
    const tag = await createTag(ctx, { name: 'VIP' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await addTagsToContact(ctx, contact.id, [tag.id]);
    await renameTag(ctx, tag.id, 'Zlatý');
    expect(await countContactTags(ctx, contact.id)).toBe(1);
  });

  it('sloučení přepíše vazby a zdrojový štítek smaže', async () => {
    const ctx = await testContext();
    const source = await createTag(ctx, { name: 'Brno' });
    const target = await createTag(ctx, { name: 'brno-mesto' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await addTagsToContact(ctx, contact.id, [source.id]);

    await mergeTags(ctx, source.id, target.id);

    expect(await tagExists(ctx, source.id)).toBe(false);
    expect(await contactHasTag(ctx, contact.id, target.id)).toBe(true);
  });

  it('sloučení nespadne u kontaktu, který má oba štítky', async () => {
    const ctx = await testContext();
    const source = await createTag(ctx, { name: 'a' });
    const target = await createTag(ctx, { name: 'b' });
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await addTagsToContact(ctx, contact.id, [source.id, target.id]);

    await expect(mergeTags(ctx, source.id, target.id)).resolves.not.toThrow();
    expect(await countContactTags(ctx, contact.id)).toBe(1);
  });

  it('hromadné označení nad 10 000 kontakty jde do jobu', async () => {
    const ctx = await testContext();
    const tag = await createTag(ctx, { name: 'VIP' });
    const ids = Array.from({ length: 10001 }, () => '00000000-0000-0000-0000-000000000000');
    const result = await bulkTagContacts(ctx, { filter: { ids }, add: [tag.id] });
    expect(result.mode).toBe('queued');
    expect(await enqueuedJobNames(ctx)).toContain('contacts.bulk_tag');
  }, 30_000);

  it('hromadné označení do limitu proběhne rovnou a job je idempotentní', async () => {
    const ctx = await testContext();
    const tag = await createTag(ctx, { name: 'VIP' });
    const a = await createActiveContact(ctx, 'a@x.cz');
    const b = await createActiveContact(ctx, 'b@x.cz');

    const sync = await bulkTagContacts(ctx, {
      filter: { ids: [a.id, b.id] },
      add: [tag.id],
    });
    expect(sync).toMatchObject({ mode: 'sync', tagged: 2 });

    // Druhý běh přes job nesmí vyrobit druhou vazbu.
    const again = await bulkTag({
      workspaceId: ctx.workspaceId,
      contactIds: [a.id, b.id],
      add: [tag.id],
      remove: [],
    });
    expect(again.tagged).toBe(0);
    expect(await countContactTags(ctx, a.id)).toBe(1);
  });
});
