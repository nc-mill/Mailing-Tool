import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { registerSubscriptionEmails, resetSubscriptionEmails } from '../../lists/subscribe-service';
import { upsertContactFromApi } from '../../repo/contacts-api';
import { asMigrator, createList, testContext } from '../support/db';

/**
 * RUČNÍ PŘIDÁNÍ KONTAKTU NA SEZNAM S DVOJÍM POTVRZENÍM.
 *
 * Do 5. 8. 2026 zapisoval `upsertContactFromApi` přihlášení napřímo přes
 * `writeSubscriptionIn` a sloupec `lists.opt_in` VŮBEC NEČETL. Volba
 * „nepotvrzený" tak vyrobila řádek `pending` bez tokenu a bez jediného e-mailu,
 * takže se z něj nedalo dostat: potvrdit neměl člověk podle čeho a správce se
 * o tom nikde nedozvěděl.
 *
 * Test se ptá DATABÁZE na vydaný token, ne jen portu na zavolání. Token je to,
 * čím se potvrzení dokončí; kdyby se vydal a e-mail neodešel, je to jiná (menší)
 * vada než dnešní stav.
 */

type Sent = { kind: 'confirmation' | 'welcome'; listId: string; token?: string };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  registerSubscriptionEmails({
    async sendConfirmation(input) {
      sent.push({ kind: 'confirmation', listId: input.listId, token: input.token });
    },
    async sendWelcome(input) {
      sent.push({ kind: 'welcome', listId: input.listId });
    },
    async sendGoodbye() {},
    async deliverRequestedItem() {},
  });
});

afterEach(() => {
  resetSubscriptionEmails();
});

async function tokensFor(ctx: WorkspaceContext, email: string): Promise<number> {
  const { rows } = await asMigrator().query<{ total: string }>(
    `SELECT count(*)::text AS total FROM subscription_confirmations c
       JOIN contacts k ON k.id = c.contact_id
      WHERE c.workspace_id = $1 AND k.email = $2`,
    [ctx.workspaceId, email],
  );
  return Number(rows[0]!.total);
}

async function statusOf(ctx: WorkspaceContext, email: string): Promise<string | null> {
  const { rows } = await asMigrator().query<{ status: string }>(
    `SELECT s.status FROM list_subscriptions s JOIN contacts k ON k.id = s.contact_id
      WHERE s.workspace_id = $1 AND k.email = $2`,
    [ctx.workspaceId, email],
  );
  return rows[0]?.status ?? null;
}

describe('ruční přidání kontaktu do seznamu', () => {
  it('nepotvrzený na seznamu s dvojím potvrzením vydá token a pošle potvrzení', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky DOI', optIn: 'double' });

    await upsertContactFromApi(ctx, {
      email: 'cekajici@x.cz',
      source: 'manual',
      status: 'unconfirmed',
      lists: [{ list_id: list.id, status: 'pending' }],
    });

    expect(await statusOf(ctx, 'cekajici@x.cz')).toBe('pending');
    expect(await tokensFor(ctx, 'cekajici@x.cz')).toBe(1);
    expect(sent).toEqual([{ kind: 'confirmation', listId: list.id, token: expect.any(String) }]);
  }, 60_000);

  it('rovnou přihlásit zůstává rozhodnutím správce: žádný token, žádný e-mail', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky rovnou', optIn: 'double' });

    await upsertContactFromApi(ctx, {
      email: 'rovnou@x.cz',
      source: 'manual',
      status: 'active',
      lists: [{ list_id: list.id, status: 'confirmed' }],
    });

    expect(await statusOf(ctx, 'rovnou@x.cz')).toBe('confirmed');
    expect(await tokensFor(ctx, 'rovnou@x.cz')).toBe(0);
    expect(sent).toEqual([]);
  }, 60_000);

  it('seznam s jedním krokem se zapíše přímo, potvrzovat není co', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky single', optIn: 'single' });

    await upsertContactFromApi(ctx, {
      email: 'jeden.krok@x.cz',
      source: 'manual',
      status: 'unconfirmed',
      lists: [{ list_id: list.id, status: 'pending' }],
    });

    // Stav zůstává ten, který zvolil správce. Kdyby se to poslalo přes
    // `subscribe()`, automat by z toho na jednokrokovém seznamu udělal
    // `confirmed`, tedy něco jiného, než co bylo na obrazovce zaškrtnuté.
    expect(await statusOf(ctx, 'jeden.krok@x.cz')).toBe('pending');
    expect(await tokensFor(ctx, 'jeden.krok@x.cz')).toBe(0);
    expect(sent).toEqual([]);
  }, 60_000);
});
