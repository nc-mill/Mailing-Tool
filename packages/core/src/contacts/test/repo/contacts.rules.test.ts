import { describe, expect, it } from 'vitest';
import { upsertContacts, writeContact } from '../../repo/contacts';
import { addSuppression } from '../../repo/suppressions';
import { countContacts, findByEmail, setStatus, testContext } from '../support/db';

describe('pravidla zápisu proti reálné databázi', () => {
  it('KRITÉRIUM 10: opakovaný zápis nevrátí odhlášeného zpět', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'j@x.cz', attributes: {} });
    await setStatus(ctx, 'j@x.cz', 'unsubscribed');
    await writeContact(ctx, { email: 'j@x.cz', status: 'active', attributes: {} });
    expect((await findByEmail(ctx, 'j@x.cz')).status).toBe('unsubscribed');
  });

  it('kontakt se stížností se nezapíše a vrátí se příznak potlačení', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'complaint', source: 'api' });
    const result = await writeContact(ctx, { email: 'j@x.cz', attributes: {} });
    expect(result.rejected).toBe('suppressed');
    expect(await countContacts(ctx)).toBe(0);
  });

  it('kontakt vymazaný podle GDPR se nezapíše ani po rotaci klíče, protože se hledá i podle otisku', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'gdpr_erasure', source: 'api' });
    expect((await writeContact(ctx, { email: 'j@x.cz', attributes: {} })).rejected).toBe(
      'suppressed',
    );
  });

  it('u mírnějšího důvodu se kontakt zapíše', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'hard_bounce', source: 'api' });
    const result = await writeContact(ctx, { email: 'j@x.cz', attributes: {} });
    expect(result.rejected).toBeNull();
    expect(await countContacts(ctx)).toBe(1);
  });

  it('VOKATIV SE POČÍTÁ PŘI ZÁPISU: greeting je ve sloupci hned po writeContact', async () => {
    const ctx = await testContext();
    await writeContact(ctx, {
      email: 'j@x.cz',
      firstName: 'Jana',
      lastName: 'Nováková',
      attributes: {},
    });
    const contact = await findByEmail(ctx, 'j@x.cz');
    expect(contact.greeting).toBe('Dobrý den, Jano');
    expect(contact.greeting_neutral).toBe('Dobrý den');
  });

  it('pravidlo 6: zamknutý vokativ přežije zápis, dokud se nezmění jméno', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'j@x.cz', firstName: 'Jana', attributes: {} });
    await lockVocative(ctx, 'j@x.cz', 'Janičko');

    await writeContact(ctx, { email: 'j@x.cz', firstName: 'Jana', attributes: {} });
    expect((await findByEmail(ctx, 'j@x.cz')).first_name).toBe('Jana');
    expect(await readVocative(ctx, 'j@x.cz')).toEqual({ vocative: 'Janičko', locked: true });

    await writeContact(ctx, { email: 'j@x.cz', firstName: 'Petra', attributes: {} });
    const after = await readVocative(ctx, 'j@x.cz');
    expect(after.locked).toBe(false);
    expect(after.vocative).not.toBe('Janičko');
  });

  it('pravidlo 1 platí i pod holým upsertem: e-mail není mezi aktualizovanými sloupci', async () => {
    // Regrese proti pokusu "opravit" upsert tak, aby uměl i změnu adresy. Kdyby ji uměl,
    // obešlo by se tím pravidlo 1 i audit contact.email_changed.
    const ctx = await testContext();
    await upsertContacts(ctx, { mode: 'update', rows: [{ email: 'a@x.cz', attributes: {} }] });
    await upsertContacts(ctx, { mode: 'overwrite', rows: [{ email: 'b@x.cz', attributes: {} }] });
    expect(await countContacts(ctx)).toBe(2);
  });
});

async function lockVocative(
  ctx: Awaited<ReturnType<typeof testContext>>,
  email: string,
  vocative: string,
): Promise<void> {
  const { asMigrator } = await import('../support/db');
  await asMigrator().query(
    `UPDATE contacts SET first_name_vocative = $3, vocative_locked = true
      WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email, vocative],
  );
}

async function readVocative(
  ctx: Awaited<ReturnType<typeof testContext>>,
  email: string,
): Promise<{ vocative: string | null; locked: boolean }> {
  const { asMigrator } = await import('../support/db');
  const { rows } = await asMigrator().query<{
    first_name_vocative: string | null;
    vocative_locked: boolean;
  }>(
    `SELECT first_name_vocative, vocative_locked FROM contacts
      WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email],
  );
  return { vocative: rows[0]!.first_name_vocative, locked: rows[0]!.vocative_locked };
}
