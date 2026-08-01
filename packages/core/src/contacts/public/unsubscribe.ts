import { sql } from 'drizzle-orm';
import { withWorkspace } from '../../tx';
import { unsubscribe } from '../lists/unsubscribe';
import { readPublicToken, type PublicEndpoint, type UnsubscribeTokenData } from '../tokens';
import { anonymousBranding, loadContact, publicScope, type PublicScope } from './context';

/**
 * Ověřený veřejný odkaz typu 'u'. Nese projekt v payloadu, takže na rozdíl od potvrzovacího
 * tokenu a slugu formuláře nepotřebuje žádné vyhledání napříč projekty.
 */
export type VerifiedPublicToken = {
  scope: PublicScope;
  data: UnsubscribeTokenData;
  listName: string | null;
};

export type PublicTokenResult =
  | { ok: true; token: VerifiedPublicToken }
  | { ok: false; branding: ReturnType<typeof anonymousBranding> };

/**
 * Přečte token, ověří, že jeho typ patří na tenhle endpoint, a doplní jména, která
 * stránka potřebuje vypsat.
 *
 * Neplatný token nikdy nevede na chybový stav navenek: každá veřejná stránka na něj
 * odpoví kódem 200 a generickou hláškou (kritérium 52).
 */
export async function readVerifiedToken(
  raw: string,
  endpoint: PublicEndpoint,
): Promise<PublicTokenResult> {
  const verified = readPublicToken(raw, endpoint);
  if (!verified.ok) return { ok: false, branding: anonymousBranding() };

  const contact = await (async () => {
    const scope = await publicScope(verified.data.workspaceId, 'contacts.public.unsubscribe');
    if (scope === null) return null;
    const found = await loadContact(scope.ctx, verified.data.contactId);
    if (found === null) return null;
    return { scope, contactLocale: found.locale };
  })();
  if (contact === null) return { ok: false, branding: anonymousBranding() };

  const listName =
    verified.data.listId === null
      ? null
      : await withWorkspace(contact.scope.ctx, async (tx) => {
          const { rows } = await tx.execute<{ name: string }>(sql`
            SELECT name FROM lists
             WHERE id = ${verified.data.listId}::uuid
               AND workspace_id = ${contact.scope.ctx.workspaceId}::uuid
          `);
          return rows[0]?.name ?? null;
        });

  return {
    ok: true,
    token: {
      scope: {
        ctx: contact.scope.ctx,
        branding: { ...contact.scope.branding, locale: contact.contactLocale },
      },
      data: verified.data,
      listName,
    },
  };
}

export type UnsubscribeScope = 'list' | 'global';

/**
 * Odhlášení z veřejné stránky i z one-click POSTu.
 *
 * Rozsah rozhoduje VÝHRADNĚ přítomnost `listId` v tokenu, nikdy tělo požadavku, aby
 * text stránky a skutečný dopad nešly rozejít. Volba „Nechci od vás už nic" je jediná
 * výjimka a předává se jako `forceGlobal`.
 */
export async function unsubscribeByToken(
  token: VerifiedPublicToken,
  input: { reason: 'link' | 'one_click' | 'preference_center'; forceGlobal?: boolean },
): Promise<{ scope: UnsubscribeScope }> {
  const listId = input.forceGlobal === true ? null : token.data.listId;
  return unsubscribe(token.scope.ctx, {
    contactId: token.data.contactId,
    // Rozsah se předává vždy explicitně, i když je null, viz kritérium 79.
    listId,
    reason: input.reason,
    campaignId: null,
  });
}
