import { describe, expect, it } from 'vitest';
import { deleteContact, restoreContact, writeContact } from '../../repo/contacts';
import { listVisibleContacts } from '../../repo/contacts';
import { changeEmailDirectly, findByEmail, testContext, type ContactRow } from '../support/db';
import type { WorkspaceContext } from '../../../identity/types';

async function write(ctx: WorkspaceContext, email: string): Promise<{ id: string }> {
  const result = await writeContact(ctx, { email, attributes: {} });
  if (result.rejected !== null) throw new Error(`kontakt ${email} byl potlačený`);
  return { id: result.id };
}

describe('mazání a obnova kontaktu', () => {
  it('měkké smazání nastaví deleted_at a status deleted, adresa zůstane', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'j@x.cz');
    await deleteContact(ctx, id, 'soft');
    const contact: ContactRow = await findByEmail(ctx, 'j@x.cz', { includeDeleted: true });
    expect(contact.deleted_at).not.toBeNull();
    expect(contact.status).toBe('deleted');
    expect(contact.email).toBe('j@x.cz');
  });

  it('obnova vrátí kontakt do provozu', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'j@x.cz');
    await deleteContact(ctx, id, 'soft');
    await restoreContact(ctx, id);
    const contact = await findByEmail(ctx, 'j@x.cz');
    expect(contact.deleted_at).toBeNull();
    expect(contact.status).not.toBe('deleted');
  });

  it('obnova selže, když mezitím vznikl živý kontakt se stejnou adresou', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'j@x.cz');
    await deleteContact(ctx, id, 'soft');
    const live = await write(ctx, 'j@x.cz');

    await expect(restoreContact(ctx, id)).rejects.toMatchObject({
      code: 'already_exists',
      params: {
        detail: 'email_taken_by_live_contact',
        // V odpovědi musí být id živého kontaktu, aby UI mohlo nabídnout sloučení.
        conflicting_contact_id: live.id,
      },
    });
  });

  it('dvě souběžné obnovy nemohou uspět obě', async () => {
    const ctx = await testContext();
    const first = await write(ctx, 'a@x.cz');
    const second = await write(ctx, 'b@x.cz');
    await deleteContact(ctx, first.id, 'soft');
    await deleteContact(ctx, second.id, 'soft');
    await changeEmailDirectly(ctx, second.id, 'a@x.cz');

    const results = await Promise.allSettled([
      restoreContact(ctx, first.id),
      restoreContact(ctx, second.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('smazaný kontakt zmizí z výpisu', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'j@x.cz');
    await deleteContact(ctx, id, 'soft');
    expect(await listVisibleContacts(ctx)).toHaveLength(0);
  });

  it('purge řádek fyzicky odstraní', async () => {
    const ctx = await testContext();
    const { id } = await write(ctx, 'j@x.cz');
    await deleteContact(ctx, id, 'purge');
    expect(await listVisibleContacts(ctx)).toHaveLength(0);
    await expect(findByEmail(ctx, 'j@x.cz', { includeDeleted: true })).rejects.toThrow();
  });

  it('obnovený kontakt je unconfirmed, ne active', async () => {
    // Přihlášení do seznamů se mazáním nezrušila, ale povýšení stavu je podle pravidla 3
    // vyhrazené potvrzení nebo ručnímu zásahu.
    const ctx = await testContext();
    const { id } = await write(ctx, 'j@x.cz');
    await deleteContact(ctx, id, 'soft');
    await restoreContact(ctx, id);
    expect((await findByEmail(ctx, 'j@x.cz')).status).toBe('unconfirmed');
  });
});
