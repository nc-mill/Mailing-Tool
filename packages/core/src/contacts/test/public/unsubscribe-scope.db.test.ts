import { keyringFromEnv } from '@mlain/contracts/keyring';
import { describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { readVerifiedToken, unsubscribeByToken } from '../../public/unsubscribe';
import { update as updateList } from '../../repo/lists';
import { issueUnsubscribeToken } from '../../tokens';
import {
  asMigrator,
  createActiveContact,
  createList,
  createSubscription,
  testContext,
} from '../support/db';

/**
 * ROZSAH ODHLÁŠENÍ SE NASTAVUJE NA SEZNAMU (`lists.unsubscribe_scope`).
 *
 * Do 7. 8. 2026 o něm rozhodovala výhradně přítomnost seznamu v podepsaném
 * tokenu, takže kliknutí na odkaz v kampani odhlásilo vždycky jen z jednoho
 * seznamu a odesílatel s tím nemohl nic udělat.
 *
 * Dvě věci, na kterých tenhle test stojí:
 *
 *  1. Nastavení musí dopadnout na SKUTEČNÝ ZÁPIS, ne jen na text stránky.
 *     Proto se kontrolují stavy přihlášení v obou seznamech a blokace adresy.
 *  2. Globální odhlášení zakládá záznam do `suppressions` pro celý projekt.
 *     Je to ta polovina následku, kterou zadavatel nezmínil a která rozhoduje
 *     o tom, jestli se projektu ještě někdy podaří té adrese něco poslat.
 */

async function statuses(ctx: WorkspaceContext, contactId: string): Promise<string[]> {
  const { rows } = await asMigrator().query<{ status: string }>(
    `SELECT status FROM list_subscriptions
      WHERE workspace_id = $1 AND contact_id = $2 ORDER BY list_id`,
    [ctx.workspaceId, contactId],
  );
  return rows.map((row) => row.status);
}

async function suppressed(ctx: WorkspaceContext, email: string): Promise<number> {
  const { rows } = await asMigrator().query<{ count: string }>(
    `SELECT count(*) AS count FROM suppressions
      WHERE workspace_id = $1 AND email = $2 AND removed_at IS NULL`,
    [ctx.workspaceId, email],
  );
  return Number(rows[0]!.count);
}

/** Dva potvrzené odběry a odhlašovací token vydaný na ten první. */
async function twoLists(ctx: WorkspaceContext, email: string) {
  const first = await createList(ctx, { name: `Novinky ${Math.random()}`, optIn: 'double' });
  const second = await createList(ctx, { name: `Akce ${Math.random()}`, optIn: 'double' });
  const contact = await createActiveContact(ctx, email);
  for (const list of [first, second]) {
    await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'confirmed' });
  }

  const token = issueUnsubscribeToken({
    workspaceId: ctx.workspaceId,
    // Zpráva neexistuje. `recordCampaignUnsubscribe` na to je připravená a vrátí
    // `campaignId: null`, odhlášení proběhne bez připsání kampani.
    messageId: '00000000-0000-7000-8000-000000000001',
    contactId: contact.id,
    listId: first.id,
    messageCreatedAt: new Date(),
    keyring: keyringFromEnv(),
  });

  return { first, second, contact, token };
}

describe('rozsah odhlášení podle nastavení seznamu', () => {
  it('výchozí seznam odhlásí jen ze sebe a adresu nezablokuje', async () => {
    const ctx = await testContext();
    const { contact, token } = await twoLists(ctx, 'jen-ze-seznamu@x.cz');

    const verified = await readVerifiedToken(token, '/u/**');
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.token.effectiveScope).toBe('list');

    const result = await unsubscribeByToken(verified.token, { reason: 'link' });

    expect(result.scope).toBe('list');
    expect(await statuses(ctx, contact.id)).toContain('confirmed');
    expect(await suppressed(ctx, 'jen-ze-seznamu@x.cz')).toBe(0);
  }, 60_000);

  it('seznam přepnutý na global odhlásí ze všech seznamů, i když token nese jeden', async () => {
    const ctx = await testContext();
    const { first, contact, token } = await twoLists(ctx, 'ze-vseho@x.cz');
    await updateList(ctx, first.id, { unsubscribeScope: 'global' });

    const verified = await readVerifiedToken(token, '/u/**');
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    // Stránka se řídí touhle hodnotou, takže text a dopad se nemají jak rozejít.
    expect(verified.token.effectiveScope).toBe('global');

    const result = await unsubscribeByToken(verified.token, { reason: 'link' });

    expect(result.scope).toBe('global');
    expect(await statuses(ctx, contact.id)).toEqual(['unsubscribed', 'unsubscribed']);
  }, 60_000);

  /**
   * Druhá polovina následku. Bez tohohle testu by šlo „rozsah" splnit tím, že se
   * odhlásí všechny seznamy, a nikdo by nepoznal, že se adresa navíc zablokovala
   * pro celý projekt.
   */
  it('globální odhlášení ze seznamu zablokuje adresu pro celý projekt', async () => {
    const ctx = await testContext();
    const { first, token } = await twoLists(ctx, 'blokace@x.cz');
    await updateList(ctx, first.id, { unsubscribeScope: 'global' });

    const verified = await readVerifiedToken(token, '/u/**');
    if (!verified.ok) throw new Error('token se nepřečetl');
    await unsubscribeByToken(verified.token, { reason: 'link' });

    expect(await suppressed(ctx, 'blokace@x.cz')).toBe(1);
  }, 60_000);
});
