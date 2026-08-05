import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import {
  registerSubscriptionEmails,
  resetSubscriptionEmails,
  subscribeToList,
} from '../../lists/subscribe-service';
import { addSuppression } from '../../repo/suppressions';
import { asMigrator, createList, testContext } from '../support/db';

/**
 * `POST /lists/{id}/subscribe` se `skip_confirmation` a prohlášením.
 *
 * Je to jediné místo, kde volající API vyrobí POTVRZENÉ přihlášení a UDĚLENÝ souhlas,
 * aniž by příjemce cokoliv udělal. Stav konkrétního seznamu přitom o globálním odhlášení
 * nic neví, takže bez kontroly suppression by se odhlášený člověk vrátil rovnou
 * do rozesílky. Prohlášení je tvrzení volajícího, ne projev vůle příjemce.
 *
 * Test se ptá databáze, ne automatu: automat má vlastní test a ten byl zelený
 * i ve chvíli, kdy se jeho výsledkem na téhle cestě nikdo neřídil.
 */

beforeEach(() => {
  registerSubscriptionEmails({
    async sendConfirmation() {},
    async sendWelcome() {},
    async sendGoodbye() {},
    async deliverRequestedItem() {},
  });
});

afterEach(() => {
  resetSubscriptionEmails();
});

async function stateOf(
  ctx: WorkspaceContext,
  email: string,
): Promise<{ subscription: string | null; consents: string[] }> {
  const subscription = await asMigrator().query<{ status: string }>(
    `SELECT s.status FROM list_subscriptions s JOIN contacts k ON k.id = s.contact_id
      WHERE s.workspace_id = $1 AND k.email = $2`,
    [ctx.workspaceId, email],
  );
  const consents = await asMigrator().query<{ status: string }>(
    `SELECT c.status FROM consents c JOIN contacts k ON k.id = c.contact_id
      WHERE c.workspace_id = $1 AND k.email = $2 ORDER BY c.created_at, c.id`,
    [ctx.workspaceId, email],
  );
  return {
    subscription: subscription.rows[0]?.status ?? null,
    consents: consents.rows.map((row) => row.status),
  };
}

describe('přihlášení přes API se zkratkou přes dvojí potvrzení', () => {
  it('adresu na živém suppression listu nepotvrdí a souhlas jí nezapíše', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky', optIn: 'double' });
    await addSuppression(ctx, {
      email: 'odhlaseny@x.cz',
      reason: 'global_unsubscribe',
      source: 'test',
    });

    await subscribeToList(ctx, {
      listId: list.id,
      email: 'odhlaseny@x.cz',
      source: 'api',
      skipConfirmation: true,
      declaration: true,
    });

    expect(await stateOf(ctx, 'odhlaseny@x.cz')).toEqual({
      subscription: 'pending',
      consents: [],
    });
  }, 60_000);

  it('adresu bez blokace potvrdí a souhlas zapíše', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky', optIn: 'double' });

    await subscribeToList(ctx, {
      listId: list.id,
      email: 'cisty@x.cz',
      source: 'api',
      skipConfirmation: true,
      declaration: true,
    });

    expect(await stateOf(ctx, 'cisty@x.cz')).toEqual({
      subscription: 'confirmed',
      consents: ['granted'],
    });
  }, 60_000);
});
