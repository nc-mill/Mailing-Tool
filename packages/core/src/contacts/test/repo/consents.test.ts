import { describe, expect, it } from 'vitest';
import { rebuildConsentState } from '../../jobs/consents-rebuild-state';
import { listConsents, recordConsent } from '../../repo/consents';
import { asAppRole, asMigrator, createActiveContact, testContext } from '../support/db';
import { all, maybeOne, one } from '../support/phase-c';

type ConsentStateRow = { status: string; legal_basis: string };

async function consentState(
  workspaceId: string,
  contactId: string,
  purpose: string,
): Promise<ConsentStateRow> {
  return one<ConsentStateRow>(
    `SELECT status, legal_basis FROM contact_consent_state
      WHERE workspace_id = $1 AND contact_id = $2 AND purpose = $3`,
    [workspaceId, contactId, purpose],
  );
}

describe('souhlasy', () => {
  it('každý zápis je nový řádek, historie se nepřepisuje', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'form',
    });
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'withdrawn',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'preference_center',
    });
    expect(await listConsents(ctx, contact.id)).toHaveLength(2);
  });

  it('KRITÉRIUM 64: aplikační role nesmí UPDATE ani DELETE nad consents', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'form',
    });

    // Kód chyby se čte ze SQLSTATE, ne z textu hlášky: 42501 je insufficient_privilege.
    // Porovnání textem by prošlo i nad nechráněnou tabulkou, protože chyba ovladače
    // má text až na cause.message.
    await expect(
      asAppRole().query(`UPDATE consents SET status = 'withdrawn'`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(asAppRole().query(`DELETE FROM consents`)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('smazání kontaktu souhlasy odstraní kaskádou, přestože role DELETE nemá', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'form',
    });
    // Kaskádu provádí systém, ne role, takže ON DELETE CASCADE funguje dál.
    // Právě proto se append-only vynucuje odebráním práv, ne pravidlem DO INSTEAD NOTHING,
    // které by kaskádu tiše zablokovalo a nechalo osiřelé řádky s osobními údaji.
    //
    // Maže se pod migrátorskou rolí: aplikační pool nemá nastavené mlain.workspace_id,
    // takže by ho politika ws_isolation odřízla a DELETE by ovlivnil nula řádků BEZ CHYBY.
    // Test by pak potvrdil kaskádu, která se nikdy nespustila.
    await asMigrator().query(`DELETE FROM contacts WHERE id = $1`, [contact.id]);

    const rows = await all(`SELECT id FROM consents WHERE workspace_id = $1`, [ctx.workspaceId]);
    expect(rows).toHaveLength(0);
  });

  it('aktuální stav se aktualizuje v téže transakci', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'analytics',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'form',
    });
    expect(await consentState(ctx.workspaceId, contact.id, 'analytics')).toMatchObject({
      status: 'granted',
      legal_basis: 'consent',
    });
  });

  it('odvolání přepíše aktuální stav, ale historii nechá', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'analytics',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'form',
    });
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'analytics',
      status: 'withdrawn',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'preference_center',
    });
    expect((await consentState(ctx.workspaceId, contact.id, 'analytics')).status).toBe('withdrawn');
    expect(await listConsents(ctx, contact.id)).toHaveLength(2);
  });

  it('ukládá doslovné znění i jeho otisk', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    const text = 'Souhlasím se zasíláním novinek.';
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'form',
      consentText: text,
    });
    const row = (await listConsents(ctx, contact.id))[0]!;
    expect(row.consent_text).toBe(text);
    expect(row.consent_text_hash).toHaveLength(32);
  });

  it('import může nést historické datum souhlasu', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    const when = new Date('2024-03-15T10:00:00.000Z');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'import',
      occurredAt: when,
    });
    expect((await listConsents(ctx, contact.id))[0]!.occurred_at).toEqual(when);
  });

  it('reaktivace je platná hodnota zdroje', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    // KRITÉRIUM 83: dřív tahle hodnota v CHECK omezení nebyla, takže reaktivační
    // kampaň by po prvním kliknutí spadla na 23514 check constraint violation.
    await expect(
      recordConsent(ctx, {
        contactId: contact.id,
        purpose: 'email_marketing',
        status: 'granted',
        legalBasis: 'consent',
        scopeListId: null,
        source: 'reactivation',
      }),
    ).resolves.not.toThrow();
  });

  it('job rebuild_state přepočítá stav z logu', async () => {
    const ctx = await testContext();
    const contact = await createActiveContact(ctx, 'j@x.cz');
    await recordConsent(ctx, {
      contactId: contact.id,
      purpose: 'analytics',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'form',
    });
    // Poškození odvozeného stavu simuluje rozejití po obnově ze zálohy. Zapisuje se
    // pod migrátorskou rolí, aby zápis neodřízla politika izolace projektu.
    await asMigrator().query(
      `UPDATE contact_consent_state SET status = 'withdrawn' WHERE contact_id = $1`,
      [contact.id],
    );

    await rebuildConsentState({ workspaceId: ctx.workspaceId });
    expect((await consentState(ctx.workspaceId, contact.id, 'analytics')).status).toBe('granted');
  });

  it('cizí projekt souhlasy nevidí', async () => {
    const a = await testContext();
    const b = await testContext();
    const contact = await createActiveContact(a, 'j@x.cz');
    await recordConsent(a, {
      contactId: contact.id,
      purpose: 'analytics',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'form',
    });
    expect(await listConsents(b, contact.id)).toHaveLength(0);
    expect(
      await maybeOne(`SELECT id FROM consents WHERE workspace_id = $1`, [b.workspaceId]),
    ).toBeNull();
  });
});
