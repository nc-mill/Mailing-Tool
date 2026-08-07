import { sql } from 'drizzle-orm';
import { withWorkspace } from '../../tx';
import { recordCampaignUnsubscribe } from '../../tracking/unsubscribe/record';
import { unsubscribe } from '../lists/unsubscribe';
import { readPublicToken, type PublicEndpoint, type UnsubscribeTokenData } from '../tokens';
import { anonymousBranding, loadContact, publicScope, type PublicScope } from './context';
import { publicListLabel } from './list-label';

/**
 * Ověřený veřejný odkaz typu 'u'. Nese projekt v payloadu, takže na rozdíl od potvrzovacího
 * tokenu a slugu formuláře nepotřebuje žádné vyhledání napříč projekty.
 */
export type VerifiedPublicToken = {
  scope: PublicScope;
  data: UnsubscribeTokenData;
  listName: string | null;
  /**
   * SKUTEČNÝ rozsah odhlášení, tedy co se stane po kliknutí. Skládá se ze dvou
   * věcí: z tokenu (nese seznam, nebo ne) a z nastavení toho seznamu
   * (`lists.unsubscribe_scope`). Seznam přepnutý na `global` odhlašuje ze všeho,
   * i když token seznam nese.
   *
   * DRŽÍ SE NA JEDNOM MÍSTĚ SCHVÁLNĚ. Text stránky a skutečný dopad se nesmí
   * rozejít, a rozešly by se v tu chvíli, kdy by si každý volající počítal
   * rozsah po svém. Stránka i zápis proto čtou tuhle jednu hodnotu.
   */
  effectiveScope: UnsubscribeScope;
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

  // Jméno se čte v PODOBĚ PRO PŘÍJEMCE, tedy `public_name`, a teprve když chybí,
  // sáhne se na pracovní `name`. Interní pojmenování („Novinky od 4. srpna 2026")
  // je poznámka správce, ne text pro toho, kdo se odhlašuje. Viz `list-label.ts`.
  //
  // TÝMŽ DOTAZEM se čte i `unsubscribe_scope`, protože obojí patří k témuž seznamu
  // a druhý dotaz by znamenal druhé místo, kde se dá zapomenout na archivovaný
  // nebo smazaný řádek.
  const listInfo =
    verified.data.listId === null
      ? null
      : await withWorkspace(contact.scope.ctx, async (tx) => {
          const { rows } = await tx.execute<{
            name: string;
            public_name: string | null;
            unsubscribe_scope: string;
          }>(sql`
            SELECT name, public_name, unsubscribe_scope FROM lists
             WHERE id = ${verified.data.listId}::uuid
               AND workspace_id = ${contact.scope.ctx.workspaceId}::uuid
          `);
          const row = rows[0];
          return row === undefined
            ? null
            : {
                label: publicListLabel({ name: row.name, publicName: row.public_name }),
                scope: row.unsubscribe_scope === 'global' ? ('global' as const) : ('list' as const),
              };
        });

  /*
   * ROZSAH SE POČÍTÁ JEDNOU, TADY.
   *
   * Token bez seznamu odhlašuje ze všeho, to platí dál. Token se seznamem
   * odhlašuje z toho seznamu, POKUD si seznam nenastavil `unsubscribe_scope`
   * na `global`; pak jedno kliknutí odhlásí ze všeho a adresu navíc zablokuje
   * pro celý projekt.
   *
   * Seznam, který se nenajde (smazaný mezitím), spadá na `list`. Je to
   * opatrnější z obou možností: neznámé nastavení nesmí vést k blokaci adresy
   * pro celý projekt.
   */
  const effectiveScope: UnsubscribeScope =
    verified.data.listId === null ? 'global' : (listInfo?.scope ?? 'list');

  return {
    ok: true,
    token: {
      scope: {
        ...contact.scope,
        ctx: contact.scope.ctx,
        branding: { ...contact.scope.branding, locale: contact.contactLocale },
      },
      data: verified.data,
      listName: listInfo?.label ?? null,
      effectiveScope,
    },
  };
}

export type UnsubscribeScope = 'list' | 'global';

/**
 * Seznam, ze kterého se odhlašuje, nebo `null` pro odhlášení ze všeho.
 *
 * JEDINÉ MÍSTO, KDE SE ROZSAH PŘEKLÁDÁ NA `listId`. Zápis, přesměrování i text
 * stránky se pak nemají jak rozejít, protože všechny vycházejí z téhož výpočtu:
 * `effectiveScope` z tokenu (token bez seznamu, nebo seznam přepnutý na
 * `global`) a volba „nechci od vás už nic" z těla požadavku.
 */
function scopedListId(token: VerifiedPublicToken, forceGlobal: boolean): string | null {
  if (forceGlobal || token.effectiveScope === 'global') return null;
  return token.data.listId;
}

/**
 * Vlastní stránka, na kterou se má člověk po odhlášení poslat, nebo `null`.
 *
 * JEN U ODHLÁŠENÍ Z JEDNOHO SEZNAMU. Přesměrování je nastavení seznamu
 * (`lists.unsubscribe_redirect_url`), takže u globálního odhlášení není podle
 * čeho vybrat, kam poslat, a vybrat „nějaký" seznam by znamenalo poslat člověka
 * na stránku, která s jeho rozhodnutím nesouvisí.
 *
 * `null` znamená „zůstane naše stránka" a je to správná výchozí volba: naše
 * stránka říká, co se právě stalo, a nabízí opravu, kdyby to bylo omylem.
 */
export async function unsubscribeRedirectFor(
  token: VerifiedPublicToken,
  options: { forceGlobal?: boolean } = {},
): Promise<string | null> {
  const listId = scopedListId(token, options.forceGlobal === true);
  if (listId === null) return null;
  return withWorkspace(token.scope.ctx, async (tx) => {
    const { rows } = await tx.execute<{ url: string | null }>(sql`
      SELECT unsubscribe_redirect_url AS url FROM lists
       WHERE id = ${listId}::uuid AND workspace_id = ${token.scope.ctx.workspaceId}::uuid
    `);
    return rows[0]?.url ?? null;
  });
}

/**
 * Odhlášení z veřejné stránky i z one-click POSTu.
 *
 * Rozsah rozhoduje `token.effectiveScope`, nikdy tělo požadavku, aby text stránky
 * a skutečný dopad nešly rozejít. Do `effectiveScope` se skládá přítomnost `listId`
 * v tokenu a nastavení seznamu `unsubscribe_scope`, viz `readVerifiedToken`.
 * Volba „Nechci od vás už nic" je jediná výjimka a předává se jako `forceGlobal`.
 */
export async function unsubscribeByToken(
  token: VerifiedPublicToken,
  input: { reason: 'link' | 'one_click' | 'preference_center'; forceGlobal?: boolean },
): Promise<{ scope: UnsubscribeScope }> {
  const listId = scopedListId(token, input.forceGlobal === true);

  /**
   * KAMPAŇ SE ODHLÁŠENÍ MUSÍ PŘIPSAT.
   *
   * Do téhle chvíle tu stálo natvrdo `campaignId: null`, takže odhlášení
   * z odkazu v kampani se v datech tvářilo jako odhlášení odnikud:
   * `list_subscriptions.unsubscribe_campaign_id` zůstalo prázdné a ve
   * statistice kampaně byla nula, i když se člověk prokazatelně odhlásil.
   *
   * Kampaň se nehádá. Odhlašovací token nese `message_id` a `message_created_at`,
   * tedy obě složky primárního klíče zprávy, a `recordCampaignUnsubscribe`
   * z té zprávy přečte `campaign_id` a zapíše událost `unsubscribe`
   * do `message_events`. Až z ní počítá report.
   *
   * Pořadí je dané: událost se zapisuje PŘED samotným odhlášením, protože
   * potřebuje jen zprávu, kdežto naopak by se `campaignId` nemělo kde vzít.
   * Když zpráva neexistuje (starý token, smazaná partition), vrátí funkce
   * `null` a odhlášení proběhne bez připsání kampani, což je správně.
   */
  const recorded = await recordCampaignUnsubscribe({
    workspaceId: token.data.workspaceId,
    messageId: token.data.messageId,
    messageCreatedAt: token.data.messageCreatedAt,
    contactId: token.data.contactId,
  });

  return unsubscribe(token.scope.ctx, {
    contactId: token.data.contactId,
    // Rozsah se předává vždy explicitně, i když je null, viz kritérium 79.
    listId,
    reason: input.reason,
    campaignId: recorded.campaignId,
  });
}
