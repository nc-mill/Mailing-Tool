import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../../identity/scope';
import type { WorkspaceContext } from '../../identity/types';
import { createLogger, type Logger } from '../../logging/logger';
import type { Tx } from '../../tx';

/**
 * PŘEKLAD POVRCHU NA ŠABLONU VEŘEJNÉ STRÁNKY.
 *
 * Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md,
 * oddíly 3 a 4.5.
 *
 * Povrch je místo, kam se návštěvník dostal, ne obrazovka: čtyři povrchy dnes
 * bydlí na třech trasách (`already_subscribed` je větev děkovací stránky).
 * Odpovědí je ID šablony `kind = 'page'`, kterou má trasa vykreslit, nebo
 * `null` ve významu VESTAVĚNÝ TEXT, tedy dnešní věta z překladového katalogu.
 *
 * PROČ TO JE JEDEN MODUL A NE ROZHODOVÁNÍ V KAŽDÉ TRASE. Pořadí hledání
 * (formulář, pak seznam) i podmínky použitelnosti (smazaná, neplatná, jiného
 * druhu) jsou u všech čtyř povrchů stejné a rozprostřené po trasách by se
 * rozešly. Přesně tou cestou vznikla vada, kdy jedna veřejná stránka vylučovala
 * jméno projektu a druhá ne.
 */

/** Povrchy z oddílu 3 plánu. */
export type PageSurface = 'form_thanks' | 'confirmed' | 'already_subscribed' | 'unsubscribed';

export type PageTemplateQuery = {
  surface: PageSurface;
  /**
   * Formulář, ze kterého se na povrch přišlo. U `form_thanks` ho zná trasa
   * přímo (návštěvník ten formulář právě odeslal), u `confirmed`
   * a `already_subscribed` se dá nechat nevyplněný a dohledá se z přihlášení
   * podle `contactId` a `listId`.
   */
  formId?: string | null;
  /** Seznam, kterého se povrch týká. Bez něj se krok „stránka seznamu" přeskočí. */
  listId?: string | null;
  /** Kontakt, jehož přihlášení nese `source_ref` s formulářem. */
  contactId?: string | null;
};

/**
 * Logger téhle domény. Vyrábí se líně a jednou, stejně jako `importLogger`:
 * P01 žádný singleton nevystavuje, jen továrnu.
 *
 * V testech běží na `fatal`, aby výpis nezaplavil běh. Pád na vestavěný text
 * je pořád ta výjimečná situace, kterou chce provoz vidět, ne šum.
 */
let instance: Logger | null = null;

function pageLogger(): Logger {
  instance ??= createLogger({
    level: process.env['NODE_ENV'] === 'test' ? 'fatal' : 'info',
    format: 'json',
    mode: 'worker',
  });
  return instance;
}

/**
 * Je odkazované ID použitelná stránka?
 *
 * TVRDÉ PRAVIDLO PLÁNU: smazaná, neplatná ani cizí šablona NIKDY nesmí skončit
 * chybou, vždycky spadne na vestavěný text a zaloguje se to. V okamžiku, kdy se
 * tahle funkce ptá, je člověk už v databázi a e-mail odeslaný, takže chybová
 * stránka by mu vzala jedinou zpětnou vazbu o tom, že se přihlášení povedlo.
 *
 * Čtyři důvody pro `null` a každý má vlastní záznam v logu, protože každý se
 * opravuje jinde:
 *
 * - řádek neexistuje nebo je měkce smazaný … někdo smazal návrh, nastavení
 *   formuláře na něj ale pořád ukazuje (u seznamu to uklidí `ON DELETE SET NULL`
 *   při tvrdém smazání, u klíče v jsonb to uklidit nemá kdo),
 * - `validation_state = 'invalid'` … návrh se po smazání kontaktního pole nebo
 *   po změně značky převalidoval do neplatného stavu; vykreslit ho by znamenalo
 *   ukázat návštěvníkovi rozbitou stránku,
 * - `kind <> 'page'` … odkaz míří na e-mail. Vykreslit obsah kampaně jako
 *   veřejnou stránku by znamenalo pustit na naši doménu blok syrového HTML,
 *   který profil stránky schválně zakazuje (4.4 plánu).
 *
 * Dotaz je jeden a podmínky jsou v něm, ne až v aplikaci: kdyby se řádek načetl
 * a rozhodovalo se nad ním, prošla by šablona z cizího projektu tím, že by ji
 * politika RLS sice nevydala, ale kód by to nepoznal od „není nastavená".
 */
async function usableTemplateId(
  tx: Tx,
  ctx: WorkspaceContext,
  templateId: string | null,
  reason: { surface: PageSurface; owner: 'form' | 'list'; ownerId: string },
): Promise<string | null> {
  if (templateId === null) return null;
  const rows = await tx
    .select({ id: schema.templates.id })
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.id, templateId),
        wsEq(ctx, schema.templates),
        isNull(schema.templates.deletedAt),
        eq(schema.templates.kind, 'page'),
        ne(schema.templates.validationState, 'invalid'),
      ),
    )
    .limit(1);
  const found = rows[0];
  if (found !== undefined) return found.id;

  pageLogger().warn(
    {
      workspace_id: ctx.workspaceId,
      surface: reason.surface,
      owner: reason.owner,
      owner_id: reason.ownerId,
      template_id: templateId,
    },
    'public_page_template_unusable',
  );
  return null;
}

/**
 * Formulář, ze kterého přihlášení přišlo.
 *
 * `list_subscriptions.source_ref` nese ID formuláře u `source = 'form'`
 * (zapisuje ho `forms/submit.ts`), a ověřeno je to v datech, ne odhadnuto.
 * Ptát se výslovně na `source = 'form'` je nutné: `source_ref` u importu nese
 * ID importu a u výmazu ID kontaktu, takže bez téhle podmínky by se hledal
 * formulář podle cizího identifikátoru.
 *
 * TOHLE JE MÍSTO, KDE STOJÍ IZOLACE MEZI FORMULÁŘI. Potvrzení, které vzniklo
 * z formuláře A, nesmí vykreslit stránku formuláře B, i kdyby oba přihlašovaly
 * do téhož seznamu.
 */
async function formIdFromSubscription(
  tx: Tx,
  ctx: WorkspaceContext,
  contactId: string,
  listId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ sourceRef: schema.listSubscriptions.sourceRef })
    .from(schema.listSubscriptions)
    .where(
      and(
        wsEq(ctx, schema.listSubscriptions),
        eq(schema.listSubscriptions.contactId, contactId),
        eq(schema.listSubscriptions.listId, listId),
        eq(schema.listSubscriptions.source, 'form'),
      ),
    )
    .limit(1);
  return rows[0]?.sourceRef ?? null;
}

/** Klíče stránek v `forms.design.pages`, viz `repo/forms.ts`. */
const FORM_KEY: Record<Exclude<PageSurface, 'unsubscribed'>, string> = {
  form_thanks: 'thanks_template_id',
  confirmed: 'confirmed_template_id',
  already_subscribed: 'already_subscribed_template_id',
};

/**
 * Odkaz na stránku uložený u formuláře. Čte se jedním dotazem přímo z jsonb,
 * ne přes `findFormById`: ten otevírá vlastní transakci a tahá celou definici
 * včetně polí, kdežto tady jde o jedinou hodnotu uvnitř už otevřené transakce.
 */
async function formTemplateId(
  tx: Tx,
  ctx: WorkspaceContext,
  formId: string,
  key: string,
): Promise<string | null> {
  const { rows } = await tx.execute<{ template_id: string | null }>(sql`
    SELECT design -> 'pages' ->> ${key} AS template_id
      FROM forms
     WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${formId}::uuid
     LIMIT 1
  `);
  return rows[0]?.template_id ?? null;
}

/** Sloupec seznamu podle povrchu. `form_thanks` seznam nemá, viz migrace 0029. */
const LIST_COLUMN = {
  confirmed: schema.lists.confirmedTemplateId,
  already_subscribed: schema.lists.alreadySubscribedTemplateId,
  unsubscribed: schema.lists.unsubscribedTemplateId,
} as const;

async function listTemplateId(
  tx: Tx,
  ctx: WorkspaceContext,
  listId: string,
  surface: keyof typeof LIST_COLUMN,
): Promise<string | null> {
  const column = LIST_COLUMN[surface];
  const rows = await tx
    .select({ templateId: column })
    .from(schema.lists)
    .where(and(wsEq(ctx, schema.lists), eq(schema.lists.id, listId)))
    .limit(1);
  return rows[0]?.templateId ?? null;
}

/**
 * Stránka pro daný povrch, nebo `null` ve významu vestavěný text.
 *
 * Pořadí hledání je z 4.5 plánu a není libovolné:
 *
 * - `form_thanks` … JEN formulář. Děkovací stránka je cíl přesměrování bez
 *   tokenu, takže se v tu chvíli neví, o který seznam ani o koho jde, a seznam
 *   o ní nemá jak rozhodnout.
 * - `confirmed` a `already_subscribed` … nejdřív FORMULÁŘ, ze kterého
 *   přihlášení přišlo, pak SEZNAM. Formulář je blíž tomu, co návštěvník právě
 *   viděl, takže když si k němu někdo navrhl stránku, musí vyhrát; seznam je
 *   společné pozadí pro formuláře, které vlastní stránku nemají.
 * - `unsubscribed` … JEN seznam. Na odhlašovací stránku se chodí z odkazu
 *   v e-mailu, ne z formuláře, takže není podle čeho určit, který formulář by
 *   ji vlastnil.
 *
 * Nastavená, ale nepoužitelná stránka NEPŘESKAKUJE na další krok a spadne rovnou
 * na vestavěný text. Je to vědomé: kdyby se propadala dál, dostal by autor, který
 * si u formuláře smazal návrh, tiše stránku seznamu, tedy jiný obsah, než jaký
 * kdy nastavil, a nepoznal by to.
 */
export async function resolvePageTemplateId(
  tx: Tx,
  ctx: WorkspaceContext,
  query: PageTemplateQuery,
): Promise<string | null> {
  const { surface } = query;

  if (surface === 'unsubscribed') {
    const listId = query.listId ?? null;
    if (listId === null) return null;
    return usableTemplateId(tx, ctx, await listTemplateId(tx, ctx, listId, surface), {
      surface,
      owner: 'list',
      ownerId: listId,
    });
  }

  // Formulář buď přišel z trasy, nebo se dohledá z přihlášení. Dohledání dává
  // smysl jen u povrchů s tokenem, protože jen u nich se ví, o který kontakt
  // a seznam jde.
  const formId =
    query.formId ??
    (surface !== 'form_thanks' && query.contactId != null && query.listId != null
      ? await formIdFromSubscription(tx, ctx, query.contactId, query.listId)
      : null);

  if (formId !== null) {
    const fromForm = await formTemplateId(tx, ctx, formId, FORM_KEY[surface]);
    if (fromForm !== null) {
      return usableTemplateId(tx, ctx, fromForm, { surface, owner: 'form', ownerId: formId });
    }
  }

  // Děkovací stránka krok se seznamem nemá, viz hlavička.
  if (surface === 'form_thanks') return null;

  const listId = query.listId ?? null;
  if (listId === null) return null;
  return usableTemplateId(tx, ctx, await listTemplateId(tx, ctx, listId, surface), {
    surface,
    owner: 'list',
    ownerId: listId,
  });
}
