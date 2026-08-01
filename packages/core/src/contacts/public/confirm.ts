import { sql } from 'drizzle-orm';
import { withWorkspace } from '../../tx';
import { classifyConfirmation } from '../lists/confirmation';
import { findConfirmationIn } from '../repo/subscriptions';
import { confirmPublicSubscription } from '../lists/confirm-service';
import type { ConfirmView, ConfirmationMode } from '../lists/confirm';
import { encodePublicRef, decodePublicRef } from './ids';
import { anonymousBranding, publicScope, type PublicBranding } from './context';

/**
 * Data potvrzovací stránky `/s/c/{ref}`.
 *
 * Stav `invalid` se vrací pro neplatný, poškozený, neexistující i cizí odkaz a stránka
 * z něj musí vykreslit BAJTOVĚ TOTOŽNÝ výstup. Kdyby se lišil, dalo by se podle odpovědi
 * zjišťovat, které kontakty a které projekty existují.
 */
export type ConfirmLookup =
  | { state: 'invalid'; branding: PublicBranding }
  | {
      state: 'valid' | 'expired' | 'consumed';
      branding: PublicBranding;
      listName: string;
      confirmationMode: ConfirmationMode;
      /** Odkaz na předvolby. Nabízí se u už použitého odkazu, ne u neplatného. */
      preferencesUrl: string | null;
    };

const INVALID: ConfirmLookup = { state: 'invalid', branding: anonymousBranding() };

/**
 * Vstup pro složení potvrzovacího odkazu.
 *
 * Vlastní typ tady není kosmetika. `scope.test.ts` zakazuje exportovanou funkci mimo
 * `packages/core/src/tx` s parametrem `workspaceId: string`, aby nikdo nepodstrčil
 * neověřený odkaz tam, kde patří ověřený kontext. Tady je `workspaceId` OBSAH, který
 * se zapisuje do adresy, ne kontext, pod kterým se sahá na data. Stejný postup použil
 * `IssueUnsubscribeTokenInput` v `tokens.ts`.
 */
export type ConfirmationRefInput = { workspaceId: string; token: string };

/** Složí veřejný odkaz do potvrzovacího e-mailu. Volá P08 při skládání šablony. */
export function buildConfirmationRef(input: ConfirmationRefInput): string {
  return encodePublicRef({ workspaceId: input.workspaceId, value: input.token });
}

export async function lookupConfirmation(ref: string): Promise<ConfirmLookup> {
  const parsed = decodePublicRef(ref);
  if (parsed === null) return INVALID;

  const scope = await publicScope(parsed.workspaceId, 'contacts.public.confirm');
  if (scope === null) return INVALID;

  // Otisk tokenu se počítá v aplikaci (`hashConfirmationToken`), ne v SQL: rozšíření
  // pgcrypto je v části 1 povolené jen pro `citext` a `digest()` by tady spadlo.
  const found = await withWorkspace(scope.ctx, async (tx) => {
    const record = await findConfirmationIn(tx, scope.ctx, parsed.value);
    if (record === null) return null;
    const { rows } = await tx.execute<{
      list_name: string;
      confirmation_mode: ConfirmationMode;
      contact_locale: string;
    }>(sql`
      SELECT l.name AS list_name, l.confirmation_mode, c.locale AS contact_locale
        FROM lists l, contacts c
       WHERE l.id = ${record.listId}::uuid AND l.workspace_id = ${scope.ctx.workspaceId}::uuid
         AND c.id = ${record.contactId}::uuid AND c.workspace_id = ${scope.ctx.workspaceId}::uuid
    `);
    const meta = rows[0];
    return meta === undefined ? null : { record, meta };
  });

  if (found === null) return INVALID;

  const state = classifyConfirmation(
    { expiresAt: found.record.expiresAt, consumedAt: found.record.consumedAt },
    new Date(),
  );
  if (state === 'unknown') return INVALID;

  return {
    state,
    branding: { ...scope.branding, locale: found.meta.contact_locale },
    listName: found.meta.list_name,
    confirmationMode: found.meta.confirmation_mode,
    preferencesUrl: null,
  };
}

export type ConfirmOutcome = {
  view: ConfirmView;
  listName: string | null;
  branding: PublicBranding;
};

/**
 * Potvrzení. Volá se VÝHRADNĚ z POSTu, nikdy z GETu (rozhodnutí R2): firemní bezpečnostní
 * skenery odkazy v e-mailech proklikávají metodou GET a potvrdily by přihlášení za člověka,
 * který o tom neví. Tím by dvojí potvrzení ztratilo důkazní hodnotu, což je jediné,
 * kvůli čemu existuje.
 */
export async function confirmByRef(
  ref: string,
  input: { requestIp: string | null; userAgent: string | null },
): Promise<ConfirmOutcome> {
  const parsed = decodePublicRef(ref);
  if (parsed === null) return { view: 'invalid', listName: null, branding: anonymousBranding() };

  const scope = await publicScope(parsed.workspaceId, 'contacts.public.confirm');
  if (scope === null) return { view: 'invalid', listName: null, branding: anonymousBranding() };

  const result = await confirmPublicSubscription(scope.ctx, {
    token: parsed.value,
    requestIp: input.requestIp,
    userAgent: input.userAgent,
  });
  return { view: result.view, listName: result.listName, branding: scope.branding };
}
