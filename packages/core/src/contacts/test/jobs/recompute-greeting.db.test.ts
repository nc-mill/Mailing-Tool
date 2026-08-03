import { describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { recomputeGreeting } from '../../jobs/recompute-greeting';
import { writeContact } from '../../repo/contacts';
import { asMigrator, findByEmail, setAddressForm, testContext } from '../support/db';

/**
 * Přepočet oslovení po změně nastavení projektu, proti skutečné databázi.
 *
 * Tenhle soubor je důkaz, ne ilustrace. Fronta `contacts.recompute_greeting`
 * neměla obsluhu, takže projekt, který přepnul z vykání na tykání, viděl novou
 * volbu v nastavení a rozesílal dál se starým oslovením. Test proto měří stav
 * PŘED a PO a u zamčeného kontaktu i to, čeho se běh dotknout NESMÍ.
 */

type VocativeState = {
  first_name_vocative: string | null;
  vocative_locked: boolean;
  vocative_confidence: string;
  vocative_reviewed_at: Date | null;
  greeting: string;
  greeting_neutral: string;
};

async function vocativeState(ctx: WorkspaceContext, email: string): Promise<VocativeState> {
  const { rows } = await asMigrator().query<VocativeState>(
    `SELECT first_name_vocative, vocative_locked, vocative_confidence,
            vocative_reviewed_at, greeting, greeting_neutral
       FROM contacts WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`kontakt ${email} v projektu není`);
  return row;
}

/** Ručně potvrzené oslovení, tedy přesně to, co fronta kontroly oslovení zapisuje. */
async function lockVocative(ctx: WorkspaceContext, email: string, vocative: string): Promise<void> {
  await asMigrator().query(
    `UPDATE contacts
        SET first_name_vocative = $3, vocative_confidence = 'high',
            vocative_locked = true, vocative_reviewed_at = now()
      WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email, vocative],
  );
}

describe('contacts.recompute_greeting proti databázi', () => {
  it('KRITÉRIUM 27: změna vykání na tykání přepočítá greeting i greeting_neutral', async () => {
    const ctx = await testContext();
    await writeContact(ctx, {
      email: 'jana@x.cz',
      firstName: 'Jana',
      lastName: 'Nováková',
      attributes: {},
    });

    // PŘED
    const before = await findByEmail(ctx, 'jana@x.cz');
    expect(before.greeting).toBe('Dobrý den, Jano');
    expect(before.greeting_neutral).toBe('Dobrý den');

    await setAddressForm(ctx, 'informal');
    const result = await recomputeGreeting({ workspaceId: ctx.workspaceId });

    // PO
    const after = await findByEmail(ctx, 'jana@x.cz');
    expect(after.greeting).toBe('Ahoj Jano');
    expect(after.greeting_neutral).toBe('Ahoj');
    expect(result.updated).toBe(1);
    expect(result.scanned).toBe(1);
  });

  it('ručně potvrzené oslovení zůstane nedotčené, přepíše se jen věta kolem něj', async () => {
    const ctx = await testContext();
    await writeContact(ctx, {
      email: 'katerina@x.cz',
      firstName: 'Kateřina',
      lastName: 'Malá',
      attributes: {},
    });
    // Člověk ve frontě kontroly oslovení zvolil jiný tvar, než co navrhla knihovna.
    await lockVocative(ctx, 'katerina@x.cz', 'Katko');
    await asMigrator().query(
      `UPDATE contacts SET greeting = 'Dobrý den, Katko', greeting_neutral = 'Dobrý den'
        WHERE workspace_id = $1 AND email = $2`,
      [ctx.workspaceId, 'katerina@x.cz'],
    );

    // PŘED
    const before = await vocativeState(ctx, 'katerina@x.cz');
    expect(before).toMatchObject({
      first_name_vocative: 'Katko',
      vocative_locked: true,
      vocative_confidence: 'high',
      greeting: 'Dobrý den, Katko',
    });

    await setAddressForm(ctx, 'informal');
    await recomputeGreeting({ workspaceId: ctx.workspaceId });

    // PO: oslovení se přepočítalo, ZÁMEK ANI VOKATIV SE NEZMĚNILY.
    const after = await vocativeState(ctx, 'katerina@x.cz');
    expect(after.greeting).toBe('Ahoj Katko');
    expect(after.greeting_neutral).toBe('Ahoj');
    expect(after.first_name_vocative).toBe('Katko');
    expect(after.vocative_locked).toBe(true);
    expect(after.vocative_confidence).toBe('high');
    expect(after.vocative_reviewed_at?.getTime()).toBe(before.vocative_reviewed_at?.getTime());
  });

  it('kontakt bez jména dostane neutrální oslovení, nikdy prázdné (nález I91)', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'info@firma.cz', attributes: {} });

    const before = await findByEmail(ctx, 'info@firma.cz');
    expect(before.greeting).toBe('Dobrý den');

    await setAddressForm(ctx, 'informal');
    await recomputeGreeting({ workspaceId: ctx.workspaceId });

    const after = await findByEmail(ctx, 'info@firma.cz');
    expect(after.greeting).toBe('Ahoj');
    expect(after.greeting).not.toBe('');
    expect(after.greeting_neutral).not.toBe('');
  });

  it('druhý běh nezmění ani řádek (idempotence)', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'petr@x.cz', firstName: 'Petr', attributes: {} });
    await setAddressForm(ctx, 'informal');

    const first = await recomputeGreeting({ workspaceId: ctx.workspaceId });
    expect(first.updated).toBe(1);

    const second = await recomputeGreeting({ workspaceId: ctx.workspaceId });
    expect(second.scanned).toBe(1);
    expect(second.updated).toBe(0);
  });

  it('smazaný a anonymizovaný kontakt se nepřepočítává', async () => {
    const ctx = await testContext();
    await writeContact(ctx, { email: 'smazany@x.cz', firstName: 'Jana', attributes: {} });
    await writeContact(ctx, { email: 'vymazany@x.cz', firstName: 'Jana', attributes: {} });
    await asMigrator().query(
      `UPDATE contacts SET deleted_at = now(), status = 'deleted'
        WHERE workspace_id = $1 AND email = $2`,
      [ctx.workspaceId, 'smazany@x.cz'],
    );
    await asMigrator().query(
      `UPDATE contacts SET anonymized_at = now() WHERE workspace_id = $1 AND email = $2`,
      [ctx.workspaceId, 'vymazany@x.cz'],
    );

    await setAddressForm(ctx, 'informal');
    const result = await recomputeGreeting({ workspaceId: ctx.workspaceId });

    expect(result.scanned).toBe(0);
    expect((await findByEmail(ctx, 'vymazany@x.cz')).greeting).toBe('Dobrý den, Jano');
  });

  it('kurzor z nákladu přeskočí, co je hotové', async () => {
    const ctx = await testContext();
    const first = await writeContact(ctx, {
      email: 'a@x.cz',
      firstName: 'Jana',
      attributes: {},
    });
    await writeContact(ctx, { email: 'b@x.cz', firstName: 'Petr', attributes: {} });
    await setAddressForm(ctx, 'informal');

    // Kurzor je ID prvního kontaktu, takže se má přepočítat jen ten druhý.
    // ID jsou uuidv7, tedy rostoucí v pořadí zápisu.
    if (first.id === null) throw new Error('kontakt se nezapsal');
    const result = await recomputeGreeting({ workspaceId: ctx.workspaceId, cursor: first.id });

    expect(result.scanned).toBe(1);
    expect((await findByEmail(ctx, 'a@x.cz')).greeting).toBe('Dobrý den, Jano');
    expect((await findByEmail(ctx, 'b@x.cz')).greeting).toBe('Ahoj Petře');
  });
});
