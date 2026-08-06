import { describe, expect, it } from 'vitest';
import { buildConfirmationRef, confirmByRef, lookupConfirmation } from '../../public/confirm';
import { issueConfirmation } from '../../repo/subscriptions';
import {
  asMigrator,
  createActiveContact,
  createList,
  createSubscription,
  testContext,
} from '../support/db';
import type { WorkspaceContext } from '../../../identity/types';

/**
 * OBĚ OBRAZOVKY POTVRZENÍ MLUVÍ JEDNÍM JAZYKEM, a to jazykem kontaktu.
 *
 * Vada z živé instalace: nabídka „Potvrdit odběr" (GET) se ukázala v jazyce
 * kontaktu, ale výsledek po kliknutí (POST) přišel v jazyce projektu. Anglický
 * kontakt v českém projektu tedy viděl dvě obrazovky za sebou ve dvou jazycích.
 * Naměřeno v prohlížeči na `<html lang>`: první „en", druhá „cs".
 *
 * Příčina byla jediný řádek: `confirmByRef` vracela `branding: scope.branding`,
 * tedy branding projektu bez přepsání jazyka, kdežto `lookupConfirmation`
 * a `readVerifiedToken` v `unsubscribe.ts` jazyk kontaktu dosazují.
 *
 * Test proto NESTAČÍ postavit na jedné větvi. Kontroluje obě a k tomu jazyk
 * projektu, aby nemohl projít shodou okolností: kdyby byl projekt taky anglický,
 * prošla by i vadná verze.
 */

async function setLocaleAndStatus(
  ctx: WorkspaceContext,
  email: string,
  locale: string,
): Promise<void> {
  await asMigrator().query(
    `UPDATE contacts SET locale = $3, status = 'unconfirmed' WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email, locale],
  );
}

async function workspaceLocale(ctx: WorkspaceContext): Promise<string> {
  const { rows } = await asMigrator().query<{ locale: string }>(
    `SELECT locale FROM workspaces WHERE id = $1`,
    [ctx.workspaceId],
  );
  return rows[0]!.locale;
}

describe('jazyk potvrzovací stránky', () => {
  it('výsledek po kliknutí je v jazyce kontaktu, ne projektu', async () => {
    const ctx = await testContext();
    // Projekt je český, kontakt anglický. Bez toho rozdílu by test nic nedokazoval.
    expect(await workspaceLocale(ctx)).toBe('cs');

    const list = await createList(ctx, { name: 'Novinky', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'anglicky@x.cz');
    await setLocaleAndStatus(ctx, 'anglicky@x.cz', 'en');
    await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'pending' });

    const { token } = await issueConfirmation(ctx, {
      contactId: contact.id,
      listId: list.id,
      ttlHours: 168,
    });
    const ref = buildConfirmationRef({ workspaceId: ctx.workspaceId, token });

    // 1. obrazovka: nabídka k potvrzení.
    const lookup = await lookupConfirmation(ref);
    expect(lookup.state).toBe('valid');
    expect(lookup.branding.locale).toBe('en');

    // 2. obrazovka: výsledek. Tady vada byla.
    const outcome = await confirmByRef(ref, { requestIp: null, userAgent: null });
    expect(outcome.view).toBe('done');
    expect(outcome.branding.locale).toBe('en');
  }, 30_000);

  it('druhé kliknutí na týž odkaz odpoví taky jazykem kontaktu', async () => {
    const ctx = await testContext();
    const list = await createList(ctx, { name: 'Novinky', optIn: 'double' });
    const contact = await createActiveContact(ctx, 'dvakrat@x.cz');
    await setLocaleAndStatus(ctx, 'dvakrat@x.cz', 'en');
    await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'pending' });

    const { token } = await issueConfirmation(ctx, {
      contactId: contact.id,
      listId: list.id,
      ttlHours: 168,
    });
    const ref = buildConfirmationRef({ workspaceId: ctx.workspaceId, token });

    await confirmByRef(ref, { requestIp: null, userAgent: null });
    // Lidé klikají dvakrát. Spotřebovaný odkaz vrací „už jste přihlášeni",
    // a i tahle obrazovka musí být v jazyce kontaktu.
    const second = await confirmByRef(ref, { requestIp: null, userAgent: null });
    expect(second.view).not.toBe('done');
    expect(second.branding.locale).toBe('en');
  }, 30_000);
});
