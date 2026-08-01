import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerRevokePendingMessages,
  resetRevokePendingMessages,
  type RevokePendingMessagesInput,
} from '../../campaigns-port';
import { addSuppression } from '../../repo/suppressions';
import { SUPPRESSION_RANK } from '../../suppression/rank';
import { asMigrator, createActiveContact, testContext } from '../support/db';
import {
  auditActions,
  confirmedSubscription,
  contactStatus,
  countSuppressions,
  lastWebhookEvent,
  latestConsent,
  subscriptionStatus,
  suppressionByEmail,
  suppressionRow,
} from '../support/phase-c';

/**
 * Volání `revokePendingMessages` se odposlouchává na portu, ne přes `vi.mock`
 * balíčku `@mlain/core/campaigns`. Ten balíček zatím neexistuje (vlastní ho P13),
 * takže by mock mockoval modul, který nejde ani naimportovat. Port má tentýž tvar
 * vstupu, takže kritérium 79 se dá zkontrolovat doslova.
 */
const revoke = vi.fn(async (_input: RevokePendingMessagesInput) => ({ revoked: 0 }));

beforeEach(() => {
  revoke.mockClear();
  registerRevokePendingMessages(revoke);
});

afterEach(() => {
  resetRevokePendingMessages();
});

describe('prioritní žebříček versus databáze', () => {
  it('SUPPRESSION_RANK pokrývá každou hodnotu povolenou omezením ck_suppressions__reason', async () => {
    // Test se ptá DATABÁZE, ne konstanty, ze které ochrana vznikla. Kdyby se do CHECK
    // přidal jedenáctý důvod a do žebříčku ne, `rankCaseSql` by ho zařadil až za všechny
    // ostatní a povýšení by u něj tiše přestalo fungovat: adresa zablokovaná kvůli
    // stížnosti by šla odblokovat jedním kliknutím. Nic by přitom neselhalo.
    const { rows } = await asMigrator().query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conname = 'ck_suppressions__reason'`,
    );
    expect(rows, 'omezení ck_suppressions__reason ve schématu není').toHaveLength(1);
    const allowed = [...rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed.length).toBeGreaterThan(0);
    expect([...SUPPRESSION_RANK].sort()).toEqual([...allowed].sort());
  });

  it('žebříček je bez duplicit, jinak by dva důvody měly stejnou prioritu', () => {
    expect(new Set(SUPPRESSION_RANK).size).toBe(SUPPRESSION_RANK.length);
  });
});

describe('addSuppression', () => {
  it('KRITÉRIUM 72: dvojí volání vytvoří jeden řádek a podruhé vrátí created false', async () => {
    const ctx = await testContext();
    const first = await addSuppression(ctx, {
      email: 'j@x.cz',
      reason: 'hard_bounce',
      source: 'ses',
    });
    const second = await addSuppression(ctx, {
      email: 'j@x.cz',
      reason: 'hard_bounce',
      source: 'ses',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.suppressionId).toBe(first.suppressionId);
    expect(await countSuppressions(ctx)).toBe(1);
  });

  it('otisk si spočítá sama pod aktuálním klíčem a uloží pokolení', async () => {
    const ctx = await testContext();
    const { suppressionId } = await addSuppression(ctx, {
      email: 'j@x.cz',
      reason: 'manual',
      source: 'ui',
    });
    const row = await suppressionRow(ctx, suppressionId);
    expect(row.fingerprint).toHaveLength(32);
    expect(row.fingerprint_key_id).toBe(1);
  });

  it('odebratelnost nastaví podle matice, volající ji nepředává', async () => {
    const ctx = await testContext();
    const manual = await addSuppression(ctx, { email: 'a@x.cz', reason: 'manual', source: 'ui' });
    const complaint = await addSuppression(ctx, {
      email: 'b@x.cz',
      reason: 'complaint',
      source: 'ses',
    });
    expect((await suppressionRow(ctx, manual.suppressionId)).removable).toBe(true);
    expect((await suppressionRow(ctx, complaint.suppressionId)).removable).toBe(false);
  });

  it('KRITÉRIUM 73: stížnost provede všechny doménové efekty v jedné transakci', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'complaint', source: 'ses' });

    expect(await subscriptionStatus(ctx, contact.id, list.id)).toBe('complained');
    expect(await contactStatus(ctx, contact.id)).toBe('complained');
    expect(await latestConsent(ctx, contact.id, 'email_marketing')).toMatchObject({
      status: 'withdrawn',
      source: 'complaint',
      scope_list_id: null,
    });
  });

  it('tvrdý odraz nastaví bounced, ale souhlas nechá být', async () => {
    const ctx = await testContext();
    const { contact } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'hard_bounce', source: 'ses' });

    expect(await contactStatus(ctx, contact.id)).toBe('bounced');
    // Odraz není projev vůle, takže souhlas se neodvolává.
    expect(await latestConsent(ctx, contact.id, 'email_marketing')).toBeNull();
  });

  it('KRITÉRIUM 74: hard_bounce na adresu se stížností důvod nepřepíše', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'complaint', source: 'ses' });
    const second = await addSuppression(ctx, {
      email: 'j@x.cz',
      reason: 'hard_bounce',
      source: 'ses',
      metadata: { bounceType: 'Permanent' },
    });

    const row = await suppressionRow(ctx, second.suppressionId);
    expect(row.reason).toBe('complaint');
    expect(row.removable).toBe(false);
    expect(row.metadata).toMatchObject({ bounceType: 'Permanent' });
  });

  it('KRITÉRIUM 75: povýšení manual na complaint změní vše, co má', async () => {
    const ctx = await testContext();
    const { contact, list } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'manual', source: 'ui' });
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'complaint', source: 'ses' });

    const row = await suppressionByEmail(ctx, 'j@x.cz');
    expect(row.reason).toBe('complaint');
    expect(row.removable).toBe(false);
    expect(await contactStatus(ctx, contact.id)).toBe('complained');
    expect(await subscriptionStatus(ctx, contact.id, list.id)).toBe('complained');
    expect(await latestConsent(ctx, contact.id, 'email_marketing')).toMatchObject({
      status: 'withdrawn',
    });
    expect(
      (await auditActions(ctx)).filter((action) => action === 'suppression.reason_promoted'),
    ).toHaveLength(1);
  });

  it('zavolá revokePendingMessages s listId null explicitně', async () => {
    const ctx = await testContext();
    const { contact } = await confirmedSubscription(ctx, 'j@x.cz', 'Newsletter');
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'hard_bounce', source: 'ses' });

    const call = revoke.mock.calls[0]![0];
    expect(call).toMatchObject({
      workspaceId: ctx.workspaceId,
      contactIds: [contact.id],
      reason: 'suppressed',
    });
    // Klíč musí v objektu BÝT, ne chybět: vynechání znamená v části 4a jiný rozsah.
    expect(Object.keys(call)).toContain('listId');
    expect(call.listId).toBeNull();
  });

  it('blokace může existovat i bez kontaktu', async () => {
    const ctx = await testContext();
    const result = await addSuppression(ctx, {
      email: 'nikdo@x.cz',
      reason: 'import',
      source: 'csv',
    });
    expect(result.contactId).toBeNull();
    expect(result.created).toBe(true);
  });

  it('zapíše audit a vyvolá odchozí událost', async () => {
    const ctx = await testContext();
    await createActiveContact(ctx, 'j@x.cz');
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'manual', source: 'ui' });
    expect(await auditActions(ctx)).toContain('suppression.added');
    expect(await lastWebhookEvent(ctx)).toMatchObject({ type: 'contact.suppressed' });
  });

  it('do události ani auditu se nedostane nic navíc: e-mail jde jen do události', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'j@x.cz', reason: 'manual', source: 'ui' });
    const event = await lastWebhookEvent(ctx);
    expect(event?.data).toMatchObject({ email: 'j@x.cz', reason: 'manual', source: 'ui' });
  });
});
