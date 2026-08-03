import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../errors/api-error';
import type { WorkspaceContext } from '../../../identity/types';
import { batchUpsertFromApi, upsertContactFromApi } from '../../repo/contacts-api';
import { addSuppression } from '../../repo/suppressions';
import { asMigrator, createList, testContext } from '../support/db';

/**
 * PRAVIDLO 4 NA CESTĚ, NE NA ČISTÉ FUNKCI.
 *
 * `applyWriteRules` má vlastní test a je zelený od začátku: u kontaktu na měkkém
 * suppression listu vrací `allowSubscriptions: false` a `allowConsents: false`. Jenže ty
 * příznaky dlouho nikdo v produkčním kódu nečetl, takže `upsertContactFromApi` zapisovalo
 * seznam i souhlas dál. Zelený test tvrdil, že pravidlo platí, a přitom nechránilo nic.
 *
 * Tenhle soubor se proto neptá funkce, ale DATABÁZE: co v `list_subscriptions`
 * a v `consents` opravdu je poté, co požadavek prošel celou cestou přes API.
 *
 * Měkký důvod = odraz, ruční blokace, odhlášení, import, neplatná adresa. Kontakt se
 * zapíše, ale nesmí dostat přihlášení ani udělený souhlas. Tvrdý důvod (`complaint`,
 * `gdpr_erasure`) je jiná věc a končí 409, což hlídají testy u ručního založení.
 */

async function subscriptionsOf(ctx: WorkspaceContext, contactId: string): Promise<string[]> {
  const { rows } = await asMigrator().query<{ status: string }>(
    `SELECT status FROM list_subscriptions WHERE workspace_id = $1 AND contact_id = $2`,
    [ctx.workspaceId, contactId],
  );
  return rows.map((row) => row.status);
}

async function consentsOf(ctx: WorkspaceContext, contactId: string): Promise<string[]> {
  const { rows } = await asMigrator().query<{ status: string }>(
    `SELECT status FROM consents WHERE workspace_id = $1 AND contact_id = $2
      ORDER BY created_at, id`,
    [ctx.workspaceId, contactId],
  );
  return rows.map((row) => row.status);
}

async function auditActions(ctx: WorkspaceContext): Promise<string[]> {
  const { rows } = await asMigrator().query<{ action: string }>(
    `SELECT action FROM audit_log WHERE workspace_id = $1 ORDER BY created_at, id`,
    [ctx.workspaceId],
  );
  return rows.map((row) => row.action);
}

describe('POST /contacts u adresy na měkkém suppression listu', () => {
  it('kontakt zapíše, ale seznam ani udělený souhlas ne', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky' });
    await addSuppression(ctx, {
      email: 'odhlaseny@example.cz',
      reason: 'global_unsubscribe',
      source: 'test',
    });

    const { contact, warnings } = await upsertContactFromApi(ctx, {
      email: 'odhlaseny@example.cz',
      first_name: 'Jan',
      lists: [{ list_id: list.id, status: 'confirmed' }],
      consent: [{ purpose: 'email_marketing', status: 'granted', legal_basis: 'consent' }],
    });

    expect(await subscriptionsOf(ctx, contact.id)).toEqual([]);
    expect(await consentsOf(ctx, contact.id)).toEqual([]);
    expect(warnings).toEqual(['suppressed_skipped']);
  });

  it('přeskok není tichý: je v auditu i s důvodem a počty', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky' });
    await addSuppression(ctx, { email: 'odraz@example.cz', reason: 'hard_bounce', source: 'test' });

    await upsertContactFromApi(ctx, {
      email: 'odraz@example.cz',
      lists: [{ list_id: list.id }],
      consent: [{ purpose: 'email_marketing', status: 'granted', legal_basis: 'consent' }],
    });

    expect(await auditActions(ctx)).toContain('contact.suppressed_write_skipped');

    const { rows } = await asMigrator().query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_log
        WHERE workspace_id = $1 AND action = 'contact.suppressed_write_skipped'`,
      [ctx.workspaceId],
    );
    expect(rows[0]?.metadata).toMatchObject({
      channel: 'api',
      reason: 'hard_bounce',
      lists_skipped: 1,
      consents_skipped: 1,
    });
  });

  /**
   * Odvolání souhlasu míří stejným směrem jako blokace. Kdyby se zahazovalo taky,
   * přišli bychom o doklad, který chceme mít nejvíc ze všech.
   */
  it('odvolání souhlasu projde i tak', async () => {
    const ctx = await testContext();
    await addSuppression(ctx, { email: 'rucne@example.cz', reason: 'manual', source: 'test' });

    const { contact, warnings } = await upsertContactFromApi(ctx, {
      email: 'rucne@example.cz',
      consent: [{ purpose: 'email_marketing', status: 'withdrawn', legal_basis: 'consent' }],
    });

    expect(await consentsOf(ctx, contact.id)).toEqual(['withdrawn']);
    expect(warnings).toEqual([]);
  });

  it('dávkový zápis nese varování u té položky, které se týká', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky' });
    await addSuppression(ctx, { email: 'blok@example.cz', reason: 'invalid', source: 'test' });

    const { results } = await batchUpsertFromApi(ctx, [
      { email: 'cisty@example.cz', lists: [{ list_id: list.id }] },
      { email: 'blok@example.cz', lists: [{ list_id: list.id }] },
    ]);

    expect(results[0]?.warnings).toBeUndefined();
    expect(results[1]?.warnings).toEqual(['suppressed_skipped']);
    expect(await subscriptionsOf(ctx, results[1]!.id!)).toEqual([]);
  });

  /**
   * Kontrolní případ. Bez něj by test prošel i tehdy, kdyby se seznamy a souhlasy
   * nezapisovaly NIKDY, což by byla horší porucha než ta opravovaná.
   */
  it('kontakt bez blokace seznam i souhlas dostane', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky' });

    const { contact, warnings } = await upsertContactFromApi(ctx, {
      email: 'cisty@example.cz',
      lists: [{ list_id: list.id }],
      consent: [{ purpose: 'email_marketing', status: 'granted', legal_basis: 'consent' }],
    });

    expect(await subscriptionsOf(ctx, contact.id)).toEqual(['pending']);
    expect(await consentsOf(ctx, contact.id)).toEqual(['granted']);
    expect(warnings).toEqual([]);
  });

  it('tvrdý důvod zůstává odmítnutím, ne přeskokem', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky' });
    await addSuppression(ctx, {
      email: 'stiznost@example.cz',
      reason: 'complaint',
      source: 'test',
    });

    await expect(
      upsertContactFromApi(ctx, {
        email: 'stiznost@example.cz',
        lists: [{ list_id: list.id }],
      }),
    ).rejects.toThrow(ApiError);
  });
});
