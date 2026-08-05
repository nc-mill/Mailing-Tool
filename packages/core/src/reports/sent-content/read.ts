import { createHtmlEngine, createTextEngine } from '@mlain/contracts/liquid/engine';
import { contentStateOf, type ContentState } from '@mlain/emails/document/content-stats';
import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';
import { notFound } from '../errors';

/**
 * Co se doopravdy rozeslalo.
 *
 * VZNIKLO Z VADY Z INSTALACE. Sekce reportu „Co se doopravdy rozeslalo" ukazovala
 * prázdný bílý rám. Byly v tom dvě různé věci najednou a obě vypadaly stejně:
 * kampaň neměla jiný obsah než patičku, a náhled navíc kreslil ZDROJOVOU podobu
 * s Liquid výrazy (`{{ workspace.sender_address }}`, `{{ unsubscribe_url }}`),
 * tedy něco, co žádnému příjemci nedošlo. Report je doklad o odeslaném e-mailu,
 * takže musí ukázat vyrenderovanou podobu a u prázdného obsahu to říct slovy.
 *
 * ODKUD SE OBSAH BERE. `campaigns.compiled_html` je zdroj kompilace a
 * `messages.render_data` jsou data, se kterými ho odesílač interpoloval. Obojí
 * dohromady je přesně to, co dostal příjemce. Renderuje se KONTRAKTNÍM enginem,
 * tedy tímtéž, který má zlaté vzorky sdílené s Go stranou; vlastní interpolace
 * by se s odesílačem rozešla a report by tvrdil něco jiného, než co odešlo.
 * Stejnou cestou jde webová verze zprávy (`contacts/public/webview.ts`).
 *
 * PROČ SE NEBERE HOTOVÉ HTML ZPRÁVY. Neukládá se: kampaň drží jednu zkompilovanou
 * podobu a zprávy k ní jen data (viz komentář ve `webview.ts`).
 */
export type SentContentRead = {
  /** Vyrenderovaná podoba. `null`, když se kampaň nikdy nezkompilovala. */
  html: string | null;
  text: string | null;
  subject: string;
  compiledAt: Date | null;
  revision: number;
  status: string;
  /**
   * Nesl e-mail vůbec nějaký obsah?
   *
   * Počítá se z `campaigns.design` funkcí `contentStateOf`, tedy podle téhož
   * pravidla jako kontrola před odesláním: patička není obsah. Z hotového HTML
   * se to poznat nedá, protože ve zkompilovaném těle už blok od bloku nikdo
   * nerozezná (značky `data-ml-block` se pro odeslání odstraňují).
   */
  contentState: ContentState;
  /**
   * Adresa zprávy, jejíž `render_data` se do náhledu dosadila. `null`, když
   * kampaň zatím žádnou zprávu nemá; pak se renderuje s prázdnými daty, což
   * je pořád pravdivější než ukázat uživateli syrové Liquid výrazy.
   */
  personalizedFor: string | null;
};

/**
 * Systémové adresy v náhledu nikam nevedou.
 *
 * Odhlašovací odkaz staví odesílač z PODEPSANÉHO tokenu pro konkrétní zprávu
 * (`apps/sender/internal/app/worker.go`). Report by ho musel podepsat znovu
 * a vyrobil by tím funkční odkaz na odhlášení cizího kontaktu jen kvůli náhledu.
 * Používá se proto tatáž hodnota jako v náhledu editoru (`preview-data.ts`).
 */
const PREVIEW_URL = '#preview-disabled';

function systemUrls(): Record<string, string> {
  return {
    unsubscribe_url: PREVIEW_URL,
    one_click_unsubscribe_url: PREVIEW_URL,
    preferences_url: PREVIEW_URL,
    webview_url: PREVIEW_URL,
  };
}

type CampaignRow = {
  subject: string | null;
  status: string;
  revision: number;
  compiled_html: string | null;
  compiled_text: string | null;
  /** Syrový dotaz nemá typový parser, takže `timestamptz` chodí i jako řetězec. */
  compiled_at: Date | string | null;
  design: unknown;
};

/** Tentýž převod, jaký dělá `campaign-stats/read.ts`, a ze stejného důvodu. */
function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type MessageRow = { email: string; render_data: Record<string, unknown> | null };

/**
 * Zpráva, podle které se dosazuje personalizace: NEJSTARŠÍ odeslaná.
 *
 * Výběr musí být určitý, jinak by se náhled při každém načtení měnil a dva lidé
 * by se dívali na jiný e-mail. `sent_at IS NOT NULL` drží slib nadpisu: co se
 * doopravdy rozeslalo, ne co ve frontě čeká.
 */
async function findSentMessage(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<MessageRow | null> {
  const { rows } = await tx.execute<MessageRow>(sql`
    SELECT email, render_data
      FROM messages
     WHERE campaign_id = ${campaignId}::uuid
       AND workspace_id = ${ctx.workspaceId}::uuid
       AND sent_at IS NOT NULL
     ORDER BY sent_at ASC, id ASC
     LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function readSentContent(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<SentContentRead> {
  const { rows } = await tx.execute<CampaignRow>(sql`
    SELECT subject, status, revision, compiled_html, compiled_text, compiled_at, design
      FROM campaigns
     WHERE id = ${campaignId}::uuid
       AND workspace_id = ${ctx.workspaceId}::uuid
       AND deleted_at IS NULL
  `);
  const campaign = rows[0];
  if (!campaign) throw notFound('campaign');

  const base = {
    subject: campaign.subject ?? '',
    compiledAt: asDate(campaign.compiled_at),
    revision: campaign.revision,
    status: campaign.status,
    contentState: contentStateOf(campaign.design),
  };

  if (campaign.compiled_html === null) {
    return { ...base, html: null, text: null, personalizedFor: null };
  }

  const message = await findSentMessage(tx, ctx, campaignId);
  /*
   * `render_data` se BERE, JAK JE. Zapsal ji outbox při skládání dávky včetně
   * `_context` a `_present`, takže se druhá příprava nedělá a dělat nesmí:
   * podruhé připravená data nejsou totéž co jednou připravená (viz webview).
   */
  const data = { ...message?.render_data, ...systemUrls() };

  const html = await createHtmlEngine().parseAndRender(campaign.compiled_html, data);
  /*
   * Textová verze jde TEXTOVÝM enginem. Kdyby se hnala HTML enginem, dosazené
   * hodnoty by se v prostém textu ukázaly jako `&amp;` a `&lt;`; escapování
   * patří do HTML, ne do textu. Odesílač to dělí stejně.
   */
  const text =
    campaign.compiled_text === null
      ? null
      : await createTextEngine().parseAndRender(campaign.compiled_text, data);

  return { ...base, html, text, personalizedFor: message?.email ?? null };
}
