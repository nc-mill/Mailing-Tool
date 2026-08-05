import { describe, expect, it } from 'vitest';
import { confirmContactManually } from '../../repo/contact-confirm';
import { listMailableContacts, writeContact } from '../../repo/contacts';
import { addSuppression } from '../../repo/suppressions';
import {
  asMigrator,
  createList,
  createSubscription,
  findByEmail,
  setStatus,
  softDelete,
  testContext,
} from '../support/db';
import type { WorkspaceContext } from '../../../identity/types';

/**
 * Ruční povýšení kontaktu na potvrzený proti REÁLNÉ DATABÁZI.
 *
 * Testuje se, že se stav OPRAVDU změnil, ne že funkce doběhla bez výjimky. Přesně tenhle
 * rozdíl je důvod, proč tahle cesta vznikla: `PATCH` s `status: 'active'` odpovídal 200
 * a odhlášený kontakt nechával být, takže „server vrátil úspěch" o změně stavu
 * nedokazovalo nic.
 */

async function seed(ctx: WorkspaceContext, email: string, status: string): Promise<string> {
  const written = await writeContact(ctx, { email, attributes: {} });
  if (written.rejected !== null) throw new Error(`kontakt ${email} byl potlačený`);
  if (status !== 'unconfirmed') await setStatus(ctx, email, status);
  return written.id;
}

async function consentsOf(ctx: WorkspaceContext, contactId: string) {
  const { rows } = await asMigrator().query<{
    status: string;
    source: string;
    legal_basis: string;
    evidence: Record<string, unknown>;
  }>(
    `SELECT status, source, legal_basis, evidence FROM consents
      WHERE workspace_id = $1 AND contact_id = $2 ORDER BY occurred_at, id`,
    [ctx.workspaceId, contactId],
  );
  return rows;
}

async function subscriptionsOf(ctx: WorkspaceContext, contactId: string) {
  const { rows } = await asMigrator().query<{
    status: string;
    confirmed_at: Date | null;
    snooze_until: Date | null;
  }>(
    `SELECT status, confirmed_at, snooze_until FROM list_subscriptions
      WHERE workspace_id = $1 AND contact_id = $2`,
    [ctx.workspaceId, contactId],
  );
  return rows;
}

async function liveSuppressions(ctx: WorkspaceContext) {
  const { rows } = await asMigrator().query<{
    reason: string;
    removed_at: Date | null;
    removal_note: string | null;
  }>(
    `SELECT reason, removed_at, removal_note FROM suppressions
      WHERE workspace_id = $1 ORDER BY created_at`,
    [ctx.workspaceId],
  );
  return rows;
}

async function auditFor(ctx: WorkspaceContext, action: string) {
  const { rows } = await asMigrator().query<{
    target_id: string;
    actor_type: string;
    actor_id: string | null;
    metadata: Record<string, unknown>;
  }>(
    `SELECT target_id, actor_type, actor_id, metadata FROM audit_log
      WHERE workspace_id = $1 AND action = $2 ORDER BY created_at, id`,
    [ctx.workspaceId, action],
  );
  return rows;
}

describe('ruční povýšení kontaktu proti reálné databázi', () => {
  it.each(['unconfirmed', 'unsubscribed', 'bounced', 'complained'])(
    'povýší kontakt ze stavu %s a stav se v databázi OPRAVDU změní',
    async (status) => {
      const ctx = await testContext();
      await seed(ctx, 'j@x.cz', status);
      expect((await findByEmail(ctx, 'j@x.cz')).status).toBe(status);

      const result = await confirmContactManually(ctx, (await findByEmail(ctx, 'j@x.cz')).id);

      expect((await findByEmail(ctx, 'j@x.cz')).status).toBe('active');
      expect(result.fromStatus).toBe(status);
      expect(result.changed).toBe(true);
    },
  );

  it('opakované povýšení nic nerozbije a přizná, že se nic neměnilo', async () => {
    const ctx = await testContext();
    const id = await seed(ctx, 'j@x.cz', 'unconfirmed');

    await confirmContactManually(ctx, id);
    const second = await confirmContactManually(ctx, id);

    expect(second.fromStatus).toBe('active');
    expect(second.changed).toBe(false);
    expect((await findByEmail(ctx, 'j@x.cz')).status).toBe('active');
  });

  it('zapíše do auditu, kdo povýšil a z jakého stavu', async () => {
    const ctx = await testContext();
    const id = await seed(ctx, 'j@x.cz', 'unsubscribed');

    await confirmContactManually(ctx, id);

    const entries = await auditFor(ctx, 'contact.manually_confirmed');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.target_id).toBe(id);
    expect(entries[0]!.metadata['from_status']).toBe('unsubscribed');
    expect(entries[0]!.metadata['changed']).toBe(true);
    // Aktér musí být dohledatelný, jinak by šlo vrátit odhlášeného člověka do rozesílky
    // a nešlo by zjistit kým. Pravidlo 3 druhou cestu připouští jen se záznamem v auditu.
    expect(entries[0]!.actor_type).toBe('user');
    expect(entries[0]!.actor_id).not.toBeNull();
  });

  it('zapíše souhlas se zdrojem admin a s prohlášením správce', async () => {
    const ctx = await testContext();
    const id = await seed(ctx, 'j@x.cz', 'unconfirmed');

    await confirmContactManually(ctx, id);

    const consents = await consentsOf(ctx, id);
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({
      status: 'granted',
      // `admin`, ne `api`: číselník `ck_consents__source` rozlišuje, kdo za souhlas ručí.
      source: 'admin',
      legal_basis: 'consent',
    });
    expect(consents[0]!.evidence['declaration']).toBe(true);

    const { rows } = await asMigrator().query<{ status: string }>(
      `SELECT status FROM contact_consent_state WHERE workspace_id = $1 AND contact_id = $2`,
      [ctx.workspaceId, id],
    );
    expect(rows[0]?.status).toBe('granted');
  });

  it('potvrdí přihlášení do seznamů a zruší jejich pozastavení', async () => {
    const ctx = await testContext();
    const id = await seed(ctx, 'j@x.cz', 'unsubscribed');
    const list = await createList(ctx, { name: 'Zákazníci' });
    const other = await createList(ctx, { name: 'Novinky' });
    await createSubscription(ctx, { contactId: id, listId: list.id, status: 'unsubscribed' });
    await createSubscription(ctx, {
      contactId: id,
      listId: other.id,
      status: 'pending',
      snoozeUntil: new Date(Date.now() + 86_400_000),
    });

    const result = await confirmContactManually(ctx, id);

    expect(result.listsConfirmed).toBe(2);
    const rows = await subscriptionsOf(ctx, id);
    expect(rows.map((row) => row.status).sort()).toEqual(['confirmed', 'confirmed']);
    for (const row of rows) {
      expect(row.confirmed_at).not.toBeNull();
      expect(row.snooze_until).toBeNull();
    }
    expect(await auditFor(ctx, 'subscription.forced_confirmed')).toHaveLength(2);
  });

  it('KRITICKÉ: odhlášenému kontaktu sundá i blokaci adresy, jinak by se mu dál nic neodeslalo', async () => {
    // Stav kontaktu není jediná brána. `listMailableContacts` i Go sender vylučují
    // zablokované adresy nezávisle na stavu, takže povýšení bez odblokování by vyrobilo
    // kontakt, který vypadá potvrzeně a nic nedostane.
    const ctx = await testContext();
    const id = await seed(ctx, 'j@x.cz', 'unconfirmed');
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'global_unsubscribe', source: 'api' });
    expect((await findByEmail(ctx, 'j@x.cz')).status).toBe('unsubscribed');
    expect(await listMailableContacts(ctx, {})).toEqual([]);

    const result = await confirmContactManually(ctx, id);

    expect(result.suppressionRemoved).toEqual(['global_unsubscribe']);
    expect(result.suppressionBlocking).toBeNull();
    const suppressions = await liveSuppressions(ctx);
    expect(suppressions[0]!.removed_at).not.toBeNull();
    expect(suppressions[0]!.removal_note).toBe('manual_confirm');
    expect(await auditFor(ctx, 'suppression.removed')).toHaveLength(1);
    // Skutečný test: kontakt je zpátky v množině, na kterou se smí poslat.
    expect((await listMailableContacts(ctx, {})).map((row) => row.email)).toEqual(['j@x.cz']);
  });

  it.each(['complaint', 'hard_bounce', 'ses_suppressed'])(
    'KRITICKÉ: u důvodu %s blokaci NEsundá a řekne, že kontakt zůstává zablokovaný',
    async (reason) => {
      // Tyhle důvody sundat nesmíme (4.10.2). Povýšení proto proběhne, ale volající
      // dostane pravdu: adresa zůstává na seznamu blokovaných a odesílání ji přeskočí.
      // Zamlčení by bylo horší než zákaz.
      const ctx = await testContext();
      const id = await seed(ctx, 'j@x.cz', 'unconfirmed');
      await addSuppression(ctx, { email: 'j@x.cz', reason: reason as 'complaint', source: 'api' });

      const result = await confirmContactManually(ctx, id);

      expect((await findByEmail(ctx, 'j@x.cz')).status).toBe('active');
      expect(result.suppressionRemoved).toEqual([]);
      expect(result.suppressionBlocking).toBe(reason);
      expect((await liveSuppressions(ctx))[0]!.removed_at).toBeNull();
      // A tohle je ten důvod, proč se to musí říct nahlas: kontakt je `active` a přesto
      // se na něj nesmí poslat.
      expect(await listMailableContacts(ctx, {})).toEqual([]);
    },
  );

  it('sundá i ruční blokaci, kterou správce sám založil', async () => {
    const ctx = await testContext();
    const id = await seed(ctx, 'j@x.cz', 'unconfirmed');
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'manual', source: 'api' });

    const result = await confirmContactManually(ctx, id);

    expect(result.suppressionRemoved).toEqual(['manual']);
    expect(result.suppressionBlocking).toBeNull();
  });

  it('nesahá na jméno, oslovení ani na zamknutý vokativ', async () => {
    // Kdyby povýšení šlo přes upsert, přepočítal by se vokativ z těla požadavku
    // a zamknutý tvar oslovení by se ztratil (pravidlo 6 ze 4.1.2).
    const ctx = await testContext();
    await writeContact(ctx, {
      email: 'j@x.cz',
      firstName: 'Jana',
      lastName: 'Nováková',
      attributes: { mesto: 'Brno' },
    });
    await asMigrator().query(
      `UPDATE contacts SET vocative_locked = true, first_name_vocative = 'Janičko',
                           greeting = 'Dobrý den, Janičko'
        WHERE workspace_id = $1 AND email = 'j@x.cz'`,
      [ctx.workspaceId],
    );
    const before = await findByEmail(ctx, 'j@x.cz');

    await confirmContactManually(ctx, before.id);

    const after = await findByEmail(ctx, 'j@x.cz');
    expect(after.status).toBe('active');
    expect(after.first_name).toBe('Jana');
    expect(after.last_name).toBe('Nováková');
    expect(after.first_name_vocative).toBe('Janičko');
    expect(after.vocative_locked).toBe(true);
    expect(after.greeting).toBe('Dobrý den, Janičko');
    expect(after.attributes).toEqual({ mesto: 'Brno' });
  });

  it('smazaný kontakt povýšit nejde, protože cesta zpátky je obnova', async () => {
    const ctx = await testContext();
    const id = await seed(ctx, 'j@x.cz', 'unconfirmed');
    await softDelete(ctx, 'j@x.cz');

    await expect(confirmContactManually(ctx, id)).rejects.toThrow();
  });

  it('kontakt z cizího projektu se netváří jako zakázaný, ale jako neexistující', async () => {
    const mine = await testContext();
    const foreign = await testContext();
    const id = await seed(foreign, 'j@x.cz', 'unconfirmed');

    await expect(confirmContactManually(mine, id)).rejects.toThrow();
  });
});
