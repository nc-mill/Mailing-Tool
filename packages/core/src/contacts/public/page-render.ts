import { sql } from 'drizzle-orm';
import type { AssetRef } from '@mlain/emails/compile/types';
import type { Document } from '@mlain/emails/document/types';
import { loadConfig } from '../../config';
import type { WorkspaceContext } from '../../identity/types';
import { createLogger, type Logger } from '../../logging/logger';
import { assetIdsInDocument, loadAssetRefs } from '../../templates/assets';
import { withWorkspace, type Tx } from '../../tx';
import type { PublicBranding } from './context';
import { publicListLabel } from './list-label';
import { resolvePageTemplateId, type PageSurface } from './page-template';

/**
 * Parametr, kterým odeslání formuláře řekne děkovací trase, že jde o větev
 * „už jste přihlášeni" (povrch `already_subscribed`).
 *
 * OBĚ STRANY HO BEROU ODSUD. Producent je `forms/submit.ts`, spotřebitel trasa
 * `/f/{slug}/thanks`; dvě zapsaná jména téhož parametru by znamenala, že se
 * větev tiše přestane vykreslovat a nikomu nic nespadne.
 *
 * Adresa se tím dá napsat i ručně, a je to v pořádku: stránka „už jste
 * přihlášeni" žádný údaj o konkrétním člověku nenese (děkovací trasa nemá
 * token, takže kontakt nezná). Prozradit tedy může jen to, že si autor
 * formuláře takovou stránku navrhl.
 */
export const ALREADY_SUBSCRIBED_QUERY = 'already';

/**
 * PODKLAD PRO VYKRESLENÍ NAVRŽENÉ VEŘEJNÉ STRÁNKY.
 *
 * Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md,
 * oddíly 3, 4.2 a 4.3.
 *
 * Dělicí čára mezi doménou a trasou je tady: doména sáhne do databáze
 * a poskládá dokument, assety a hodnoty proměnných, trasa z toho udělá HTML.
 * Vykreslení samo (`renderPageHtml`) v doméně schválně NENÍ, protože trasa
 * musí umět jeho pád zachytit a spadnout na vestavěný text; kdyby renderovala
 * doména, měl by pád podobu výjimky uprostřed čtení z databáze a trasa by ho
 * nerozeznala od výpadku spojení.
 *
 * `null` znamená VESTAVĚNÝ TEXT, tedy dnešní věta z překladového katalogu.
 * Vrací se pro nenastavenou stránku, pro nepoužitelnou (smazanou, neplatnou,
 * cizí) i pro jakoukoliv chybu při čtení. Nikdy se nevyhazuje výjimka: v tu
 * chvíli, kdy se tahle funkce ptá, je kontakt už zapsaný, potvrzený nebo
 * odhlášený a chybová stránka by člověka poslala klikat znovu.
 */
export type PublicPageDesign = {
  document: Document;
  assets: Record<string, AssetRef>;
  assetBaseUrl: string;
  /** Jazyk dodávaných textů, tedy jazyk kontaktu nebo projektu. */
  language: string;
  /** Hodnoty proměnných podle povrchu, viz `pageVariables`. */
  data: Record<string, unknown>;
};

export type PublicPageQuery = {
  ctx: WorkspaceContext;
  surface: PageSurface;
  branding: PublicBranding;
  /** Formulář, ze kterého se na povrch přišlo. U `form_thanks` ho zná trasa. */
  formId?: string | null;
  listId?: string | null;
  contactId?: string | null;
  /** Název formuláře pro `{{ data.form_name }}`. Jen u `form_thanks`. */
  formName?: string | null;
  /** Název seznamu pro `{{ data.list_name }}`, v podobě PRO PŘÍJEMCE. */
  listName?: string | null;
};

let instance: Logger | null = null;

/** Týž logger jako u překladače povrchů, ze stejného důvodu (v testech mlčí). */
function pageLogger(): Logger {
  instance ??= createLogger({
    level: process.env['NODE_ENV'] === 'test' ? 'fatal' : 'info',
    format: 'json',
    mode: 'worker',
  });
  return instance;
}

type ContactRow = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  greeting: string | null;
  attributes: Record<string, unknown> | null;
};

/**
 * KOŘEN `workspace` NESE JMÉNO ODESÍLATELE, NE JMÉNO PROJEKTU.
 *
 * V e-mailu je `{{ workspace.name }}` název projektu (`campaigns/render-roots.ts`),
 * protože e-mail čte příjemce ve své schránce a odesílatele vidí v poli Od.
 * Na veřejné stránce ale platí opačné pravidlo, které 7. 8. 2026 nahlásil
 * zadavatel: jméno projektu si člověk zakládá pro sebe („Petr Osobní mail",
 * „Klient Novák, faktury") a na stránce, kterou vidí cizí lidé, nemá co dělat.
 * Podrobně v `PublicBranding.senderName`.
 *
 * Proměnná se proto NERUŠÍ, jen se plní jménem odesílatele. Zrušit by ji
 * znamenalo, že text zkopírovaný z e-mailu na stránce mlčky zmizí, a to je
 * přesně ta třída tiché vady, kterou katalog povrchů zakazuje.
 */
function workspaceRoot(branding: PublicBranding, postalAddress: string): Record<string, unknown> {
  return { name: branding.senderName, sender_address: postalAddress };
}

/**
 * Hodnoty proměnných podle povrchu, tabulka 4.3 plánu.
 *
 * `form_thanks` KONTAKT NEDOSTANE, a není to opomenutí: děkovací stránka je cíl
 * přesměrování 303 bez tokenu, takže se o návštěvníkovi neví nic. Kdyby se sem
 * kontakt dohledal jinudy (třeba podle adresy z formuláře), stala by se
 * z děkovací stránky nástroj na zjišťování, kdo je v databázi.
 */
function pageVariables(input: {
  surface: PageSurface;
  branding: PublicBranding;
  postalAddress: string;
  formName: string | null;
  listName: string | null;
  contact: ContactRow | null;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    workspace: workspaceRoot(input.branding, input.postalAddress),
    data: {
      ...(input.surface === 'form_thanks' ? { form_name: input.formName ?? '' } : {}),
      list_name: input.listName ?? '',
    },
    _context: { locale: input.branding.locale, timezone: 'UTC' },
  };
  if (input.surface !== 'form_thanks' && input.contact !== null) {
    data['contact'] = {
      email: input.contact.email,
      first_name: input.contact.first_name ?? '',
      last_name: input.contact.last_name ?? '',
      greeting: input.contact.greeting ?? '',
      attr: input.contact.attributes ?? {},
    };
  }
  return data;
}

/**
 * Načte navrženou stránku pro povrch, nebo `null` ve významu vestavěný text.
 *
 * Jedna transakce na všechno: překlad povrchu na šablonu, dokument, assety,
 * poštovní adresa a kontakt. Veřejná stránka se otevírá na mobilu a každé další
 * kolo do databáze zaplatí čekáním člověk, který právě klikl na odkaz v e-mailu.
 */
export async function loadPublicPageDesign(
  query: PublicPageQuery,
): Promise<PublicPageDesign | null> {
  const { ctx, surface } = query;
  try {
    return await withWorkspace(ctx, async (tx) => {
      const templateId = await resolvePageTemplateId(tx, ctx, {
        surface,
        formId: query.formId ?? null,
        listId: query.listId ?? null,
        contactId: query.contactId ?? null,
      });
      if (templateId === null) return null;

      const { rows } = await tx.execute<{ design: Document }>(sql`
        SELECT design FROM templates
         WHERE id = ${templateId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
      `);
      const document = rows[0]?.design;
      if (document === undefined) return null;

      const [assets, postalAddress, contact, listName] = await Promise.all([
        loadAssetRefs(tx, ctx, assetIdsInDocument(document)),
        readPostalAddress(tx, ctx),
        surface === 'form_thanks' || query.contactId == null
          ? Promise.resolve(null)
          : readContact(tx, ctx, query.contactId),
        // Název seznamu si trasa nemusí obstarávat sama, když ho po ruce nemá.
        // Čte se v PODOBĚ PRO PŘÍJEMCE (`public_name`), protože pracovní název
        // („Novinky od 4. srpna") je poznámka správce, ne text pro návštěvníka.
        query.listName != null || query.listId == null
          ? Promise.resolve(query.listName ?? null)
          : readListLabel(tx, ctx, query.listId),
      ]);

      return {
        document,
        assets,
        assetBaseUrl: loadConfig().ASSET_BASE_URL,
        language: query.branding.locale,
        data: pageVariables({
          surface,
          branding: query.branding,
          postalAddress,
          formName: query.formName ?? null,
          listName,
          contact,
        }),
      };
    });
  } catch (error) {
    // Vestavěný text je vždycky lepší než chybová stránka, viz hlavička typu.
    pageLogger().warn(
      {
        workspace_id: ctx.workspaceId,
        surface,
        err: error instanceof Error ? error.message : String(error),
      },
      'public_page_design_unavailable',
    );
    return null;
  }
}

/** `workspaces.settings.campaigns.postal_address`, tedy `{{ workspace.sender_address }}`. */
async function readPostalAddress(tx: Tx, ctx: WorkspaceContext): Promise<string> {
  const { rows } = await tx.execute<{ postal_address: string | null }>(sql`
    SELECT settings #>> '{campaigns,postal_address}' AS postal_address
      FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
  `);
  return rows[0]?.postal_address ?? '';
}

async function readListLabel(
  tx: Tx,
  ctx: WorkspaceContext,
  listId: string,
): Promise<string | null> {
  const { rows } = await tx.execute<{ name: string; public_name: string | null }>(sql`
    SELECT name, public_name FROM lists
     WHERE id = ${listId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
  `);
  const row = rows[0];
  return row === undefined
    ? null
    : publicListLabel({ name: row.name, publicName: row.public_name });
}

async function readContact(
  tx: Tx,
  ctx: WorkspaceContext,
  contactId: string,
): Promise<ContactRow | null> {
  const { rows } = await tx.execute<ContactRow>(sql`
    SELECT email::text AS email, first_name, last_name, greeting, attributes
      FROM contacts
     WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
       AND deleted_at IS NULL
  `);
  return rows[0] ?? null;
}
