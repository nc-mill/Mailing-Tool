import { createHtmlEngine } from '@mlain/contracts/liquid/engine';
import { sql } from 'drizzle-orm';
import { withWorkspace } from '../../tx';
import {
  readCampaignRootsSource,
  withCampaignRoots,
  type CampaignRootsSource,
} from '../../campaigns/render-roots';
import type { VerifiedPublicToken } from './unsubscribe';

/**
 * Zobrazení odeslané zprávy v prohlížeči, `/v/{token}`.
 *
 * PROČ TO VŮBEC EXISTUJE. Odesílač skládá `{{ webview_url }}` jako
 * TRACKING_DOMAIN + `/v/` + odhlašovací token (`apps/sender/internal/token/urls.go`,
 * `apps/sender/internal/app/worker.go`) a vkládá ho do patičky každé zprávy, která má
 * v šabloně zapnuté „Zobrazit v prohlížeči". Na webu ale žádná obsluha `/v/` nebyla,
 * takže ten odkaz v každém odeslaném e-mailu končil na 404. Chyběla celá obrazovka,
 * nešlo o překlep v tokenu.
 *
 * AUTORIZACE JE VÝHRADNĚ TOKEN, žádná session. Je to tentýž podepsaný token typu 'u'
 * jako u odhlášení a předvoleb, takže platí i totéž o jeho rozsahu: kdo ho drží, dostal
 * ho v e-mailu na svoji adresu.
 *
 * PERSONALIZACE JE PLNÁ. Zpráva má v `messages.render_data` uložená přesně ta data,
 * se kterými ji odesílač vyrenderoval, takže se `compiled_html` kampaně interpoluje
 * podruhé týmž kontraktním Liquidem a příjemce uvidí SVOJI podobu, ne obecnou. Text
 * se nerenderuje: stránka je HTML.
 *
 * PROČ SE NEUKLÁDÁ HOTOVÉ HTML ZPRÁVY. Neukládá ho nikdo: kampaň drží jednu
 * zkompilovanou podobu a zprávy k ní jen data. Uložit vyrenderovanou podobu každé
 * zprávy by u kampaně na sto tisíc adres znamenalo sto tisíc kopií téhož HTML.
 */
export type WebviewResult =
  | { state: 'ok'; html: string; subject: string }
  /** Zpráva, kampaň nebo její zkompilovaná podoba chybí. Stránka na to odpoví hláškou. */
  | { state: 'unavailable' };

type MessageRow = { campaign_id: string | null; render_data: Record<string, unknown> | null };

/**
 * Dohledá zprávu podle obou složek primárního klíče.
 *
 * Podmínka na `created_at` tu NESMÍ chybět a není to optimalizace: `messages` je
 * partitionovaná podle `created_at`, takže dotaz bez ní projde všechny partition.
 * Okno je stejné jako u trackingu (`tracking/repo/messages.repo.ts`), protože token
 * nese čas v celých sekundách a uložená hodnota má zlomky.
 */
async function findMessage(
  token: VerifiedPublicToken,
  seconds: number,
): Promise<MessageRow | null> {
  return withWorkspace(token.scope.ctx, async (tx) => {
    const { rows } = await tx.execute<MessageRow>(sql`
      SELECT campaign_id, render_data
        FROM messages
       WHERE id = ${token.data.messageId}::uuid
         AND workspace_id = ${token.scope.ctx.workspaceId}::uuid
         AND created_at >= to_timestamp(${seconds}) - interval '1 second'
         AND created_at <  to_timestamp(${seconds}) + interval '2 seconds'
       LIMIT 1
    `);
    return rows[0] ?? null;
  });
}

async function findCampaign(
  token: VerifiedPublicToken,
  campaignId: string,
): Promise<{
  compiled_html: string | null;
  subject: string | null;
  roots: CampaignRootsSource | null;
} | null> {
  return withWorkspace(token.scope.ctx, async (tx) => {
    const { rows } = await tx.execute<{ compiled_html: string | null; subject: string | null }>(sql`
      SELECT compiled_html, subject
        FROM campaigns
       WHERE id = ${campaignId}::uuid
         AND workspace_id = ${token.scope.ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);
    const row = rows[0];
    if (!row) return null;
    const roots = await readCampaignRootsSource(tx, token.scope.ctx, campaignId);
    return { ...row, roots };
  });
}

/**
 * Adresy, které do `render_data` nikdy nepatří a skládá je až odesílač z tokenu
 * (`campaigns/audience/render-data.ts`). Webview je musí doplnit ze stejného tokenu,
 * jinak by Liquid dosadil prázdný řetězec a patička by v prohlížeči nabízela
 * odhlášení odkazem nikam.
 */
function systemUrls(rawToken: string): Record<string, string> {
  return {
    unsubscribe_url: `/u/${rawToken}`,
    one_click_unsubscribe_url: `/u/${rawToken}`,
    preferences_url: `/p/${rawToken}`,
    webview_url: `/v/${rawToken}`,
  };
}

export async function loadWebview(
  token: VerifiedPublicToken,
  rawToken: string,
): Promise<WebviewResult> {
  const seconds = Math.floor(token.data.messageCreatedAt.getTime() / 1000);
  const message = await findMessage(token, seconds);
  if (message === null || message.campaign_id === null) return { state: 'unavailable' };

  const campaign = await findCampaign(token, message.campaign_id);
  if (campaign === null || campaign.compiled_html === null) return { state: 'unavailable' };

  /*
   * Renderuje se KONTRAKTNÍM enginem, tedy tímtéž, který má zlaté vzorky sdílené
   * s Go stranou (`packages/contracts/fixtures/liquid`). Vlastní interpolace by se
   * s odesílačem dřív nebo později rozešla a příjemce by v prohlížeči viděl jinou
   * zprávu, než mu přišla do schránky.
   *
   * `render_data` je už PŘIPRAVENÁ (`_context`, `_present`), zapsal ji outbox při
   * skládání dávky, takže se druhá příprava nedělá a dělat nesmí: podruhé připravená
   * data nejsou totéž co jednou připravená.
   */
  /*
   * Kořeny `campaign` a `workspace` v render_data NEJSOU: dodává je odesílač
   * z hlavičky kampaně, protože jsou konstantní pro celou kampaň a kopie do
   * každé zprávy by u milionové kampaně stála stovky megabajtů. Webová podoba
   * je proto musí doplnit ze stejného zdroje, jinak by v prohlížeči chyběla
   * poštovní adresa v patičce, kterou příjemce v e-mailu VIDĚL. Je to táž
   * úvaha jako u systémových adres o pár řádků výš.
   */
  const withUrls = { ...(message.render_data ?? {}), ...systemUrls(rawToken) };
  const { data, roots } =
    campaign.roots === null
      ? { data: withUrls, roots: null }
      : await withCampaignRoots(withUrls, campaign.roots);

  const html = await createHtmlEngine().parseAndRender(campaign.compiled_html, data);
  // Předmět stránky je VYRENDEROVANÝ, ne zdroj: personalizovaný předmět by
  // v titulku ukázal `Ahoj {{ contact.first_name }}`.
  return { state: 'ok', html, subject: roots?.campaign.subject ?? campaign.subject ?? '' };
}
