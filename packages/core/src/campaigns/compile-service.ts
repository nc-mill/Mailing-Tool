import { toPreparedSchema } from '@mlain/emails/paths';
import type { Document } from '@mlain/emails/document/types';
import { loadConfig } from '../config/index';
import { getFieldCatalog } from '../contacts/fields/catalog';
import { ApiError } from '../errors/api-error';
import { compileTemplate } from '../templates/compile';
import { withWorkspace, type WorkspaceContext } from '../tx';
import {
  assertCompileMetaMatches,
  normalizeCompileOutput,
  renderPlanFrom,
  type CampaignCompilation,
} from './compile';
import { readCampaignCompileSource, readCompileMeta, saveCompilationTx } from './repo/campaign';
import { replaceCampaignLinksTx } from './repo/links';
import type { RenderPlan } from './repo/outbox';

/**
 * Kompilace kampaně: jediná cesta, kterou `compiled_html`, `compiled_text`,
 * `compile_meta` a `campaign_links` vznikají.
 *
 * ODCHYLKA OD PLÁNU, VĚDOMÁ. Plán volal kompilaci přes `TemplatePort`. Ten port
 * v repozitáři nikdo neimplementuje ani neregistruje a jeho tvar navíc neodpovídá
 * skutečné funkci (deklaruje `workspaceId: string`, `compileTemplate` bere celý
 * `WorkspaceContext`). Volá se proto přímo doménová funkce šablon, stejně jako
 * `preflight-view.ts` volá přímo `getProviderById`. Druhý kompilátor nevzniká,
 * je to táž `compileTemplate` nad `@mlain/emails`, jakou používá náhled šablony.
 *
 * `toPreparedSchema` se bere z `@mlain/emails/paths` z téhož důvodu: je to jediná
 * povolená cesta, jak zúžit `RenderSchema` kontraktu 5 na tvar, který bere
 * `prepareRenderData`. Přetypováním by se kontrola ztratila úplně.
 */

/** Jazyk kompilace nese dokument, ne požadavek. Stejné pravidlo jako u šablon. */
function languageOf(design: unknown): string {
  const meta = (design as { meta?: { language?: unknown } } | null)?.meta;
  return typeof meta?.language === 'string' && meta.language !== ''
    ? meta.language
    : loadConfig().DEFAULT_LOCALE;
}

function preheaderOf(design: unknown, fallback: string): string {
  if (fallback !== '') return fallback;
  const meta = (design as { meta?: { previewText?: unknown } } | null)?.meta;
  return typeof meta?.previewText === 'string' ? meta.previewText : '';
}

/**
 * Kompilace BEZ zápisu. Používá ji kontrola před odesláním, která jen porovnává;
 * kdyby zapisovala, prala by se se stavovým strojem o řádek, který právě odchází.
 */
async function compileWithoutSaving(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<{ status: string; compilation: CampaignCompilation }> {
  const campaign = await readCampaignCompileSource(ctx, campaignId);
  if (!campaign) throw new ApiError('not_found');
  if (campaign.design === null || campaign.design === undefined) {
    // Kampaň bez obsahu není rozporem kontraktu, ale nedodělanou prací uživatele.
    throw new ApiError('campaign_not_compiled', { params: { reason: 'campaign_design_missing' } });
  }
  if (campaign.subject.trim() === '') {
    throw new ApiError('campaign_subject_missing');
  }

  const fields = await getFieldCatalog(ctx);
  const config = loadConfig();
  const preheader = preheaderOf(campaign.design, campaign.preheader);

  const result = await withWorkspace(ctx, (tx) =>
    compileTemplate({
      tx,
      ctx,
      document: campaign.design as Document,
      templateKind: 'campaign',
      fields,
      language: languageOf(campaign.design),
      assetBaseUrl: config.ASSET_BASE_URL,
      // 'send' vyžaduje campaignId, protože z něj kompilace odvozuje UUIDv5 odkazů.
      purpose: 'send',
      campaignId,
      trackOpens: campaign.track_opens,
      trackClicks: campaign.track_clicks,
      preheader,
    }),
  );

  if (!result.ok) {
    // Chyby šablony jsou chyby uživatele, ne rozpor kontraktu.
    throw new ApiError('template_document_invalid', {
      findings: result.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity === 'error' ? ('error' as const) : ('warning' as const),
        message: issue.code,
        ...(issue.params === undefined ? {} : { params: issue.params }),
      })),
    });
  }

  return {
    status: campaign.status,
    compilation: normalizeCompileOutput(
      result.meta,
      { html: result.html, text: result.text },
      { design: campaign.design, subject: campaign.subject, preheader },
    ),
  };
}

/**
 * Zkompiluje kampaň a uloží výsledek. Jediná cesta, kterou `compiled_html`,
 * `compiled_text`, `compile_meta` a `campaign_links` vznikají.
 *
 * Pořadí kroků je závazné. Odkazy se zapisují ve STEJNÉ transakci jako
 * `compile_meta`, protože jsou to dvě kopie téhož seznamu: kdyby se uložila jen
 * jedna, sender by porovnával značky proti metadatům, která neodpovídají řádkům
 * v `campaign_links`, a proklik by se spároval s neexistujícím odkazem.
 *
 * Kompilace projde jen ve stavech `draft`, `schedule_missed` a `failed`. Vynucuje
 * to podmínka v `saveCompilationTx`, ne kontrola před ní: mezi kontrolou a zápisem
 * se dá stihnout odeslání a `compile_meta` je po přechodu do `sending` neměnná (D18).
 */
export async function compileCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignCompilation> {
  const { status, compilation } = await compileWithoutSaving(ctx, campaignId);

  await withWorkspace(ctx, async (tx) => {
    const updated = await saveCompilationTx(tx, ctx.workspaceId, campaignId, {
      html: compilation.html,
      text: compilation.text,
      usedPaths: compilation.compileMeta.usedPaths,
      compileMeta: compilation.compileMeta,
      compiledHash: compilation.compiledHash,
    });
    if (updated === 0) {
      // Kampaň mezitím opustila draft. compile_meta je po přechodu do sending neměnná (D18).
      throw new ApiError('campaign_locked', { params: { status } });
    }
    await replaceCampaignLinksTx(tx, ctx.workspaceId, campaignId, compilation.compileMeta.links);
  });

  return compilation;
}

/**
 * Plán pro render pro materializaci. Bere se z ULOŽENÉ `compile_meta`, nikdy se
 * nekompiluje znovu: druhá kompilace téhož designu je sice deterministická, ale
 * kdyby se mezitím změnil renderer, materializace by použila jiná data než ta,
 * která odešel sender.
 */
export async function renderPlanForCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<RenderPlan> {
  const meta = await readCompileMeta(ctx, campaignId);
  if (!meta) {
    throw new ApiError('campaign_not_compiled', {
      params: { reason: 'compile_meta_missing', campaign_id: campaignId },
    });
  }
  return renderPlanFrom(meta, toPreparedSchema);
}

/**
 * Poslední kontrola před odesláním: sedí ULOŽENÁ `compile_meta` na to, co kompilace
 * vrací TEĎ? Volá se z cesty `POST /campaigns/{id}/send`, před přechodem do queueing.
 *
 * Je to třetí část rozhodnutí D17 a bez ní jsou zbylé dvě k ničemu. Odkazy se párují
 * podle `campaign_links.id`, které pochází z `CompileMeta`. Kdyby se šablona mezi
 * kompilací a odesláním změnila, kompilace by vyrobila jiná ID, proklik by se spároval
 * s neexistujícím odkazem a report kliků by zůstal prázdný bez jediné chybové hlášky.
 *
 * ODCHYLKA OD PLÁNU, VĚDOMÁ. Plán tady volal `compileCampaign`, tedy variantu,
 * která výsledek ULOŽÍ. Ověřeno spuštěním, že to nejde: `saveCompilation` povoluje
 * `draft`, `schedule_missed` a `failed`, kdežto odeslat jde i kampaň ve stavu
 * `scheduled`. Zápisná varianta by u naplánované kampaně vrátila `campaign_locked`
 * místo odeslání a u kampaně ve stavu `sent` by přebila správnou chybu stavu.
 * Kontrola tedy jen POROVNÁVÁ a nic nezapisuje; k porovnání ukládat netřeba.
 */
export async function assertCompilationCurrent(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<void> {
  const stored = await readCompileMeta(ctx, campaignId);
  const { compilation } = await compileWithoutSaving(ctx, campaignId);
  assertCompileMetaMatches(stored, compilation.compileMeta);
}
