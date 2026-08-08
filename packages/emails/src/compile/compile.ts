import type { Issue } from '../issue';
import type { DateFormat, Document } from '../document/types';
import { renderDocumentHtml } from '../emitter/render';
import { normalizeDocument } from '../normalize/index';
import { renderDocumentText } from '../text/emit';
import { RAW_SLOT_PREFIX } from '../normalize/slots';
import { applyFilterSlots } from './apply-slots';
import { checkInvariants } from './invariants';
import { collectLinks } from './links';
import { buildRenderSchema } from './render-schema';
import {
  CONTRACT_VERSION,
  RENDERER_VERSION,
  type CompileContext,
  type CompileMeta,
  type CompileResult,
} from './types';

/** Whitelist celých formátů z kontraktu (část 1, 4.10.2). Nic jiného neprojde. */
export const ALLOWED_DATE_FORMATS: readonly DateFormat[] = [
  '%d.%m.%Y',
  '%-d.%-m.%Y',
  '%Y-%m-%d',
  '%d.%m.%Y %H:%M',
  '%H:%M',
];

const FORBIDDEN_IN_FALLBACK = /["'{}<>]/;

export async function compileDocument(doc: Document, ctx: CompileContext): Promise<CompileResult> {
  const issues: Issue[] = [];

  if (ctx.purpose === 'send' && !ctx.campaignId) {
    return {
      ok: false,
      issues: [{ code: 'compile_campaign_id_required', severity: 'error', pointer: '' }],
    };
  }

  const normalized = normalizeDocument(doc, { language: ctx.language });

  // Hodnoty argumentů filtrů se validují proti témuž whitelistu, jaký hlídá
  // validátor u atributu bloku. Kompilace je jediné místo, které smí argument vyrobit.
  for (const slot of normalized.filterSlots) {
    if (slot.filter === 'date' && !ALLOWED_DATE_FORMATS.includes(slot.value as DateFormat)) {
      issues.push({
        code: 'liquid_date_format_not_allowed',
        severity: 'error',
        pointer: '',
        params: { format: slot.value, blockId: slot.blockId },
      });
    }
    if (slot.filter === 'default' && FORBIDDEN_IN_FALLBACK.test(slot.value)) {
      issues.push({
        code: 'liquid_default_value_invalid',
        severity: 'error',
        pointer: '',
        params: { blockId: slot.blockId },
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const links = collectLinks(normalized.doc, {
    campaignId: ctx.campaignId,
    trackClicks: ctx.trackClicks,
    skippedBlockIds: normalized.skippedBlockIds,
  });
  if (links.issues.length > 0) return { ok: false, issues: links.issues };

  // Veřejná stránka se nesleduje: nestojí za ní kampaň, které by se otevření
  // připsalo, a pixel by byl jen značka, kterou nikdo nezpracuje.
  const isPage = ctx.templateKind === 'page';
  const trackOpens = ctx.trackOpens && ctx.templateKind !== 'system' && !isPage;
  // Vynechaná volba znamená ZAPNUTO, viz `CompileContext.preferenceCenterEnabled`.
  const preferenceCenterEnabled = ctx.preferenceCenterEnabled !== false;

  const renderedHtml = await renderDocumentHtml({
    normalized,
    // Obal se volí podle profilu, ne podle volby volajícího: kdyby si ho směl
    // vybrat, dala by se stránka zkompilovat do e-mailového obalu a naopak.
    shell: isPage ? 'page' : 'email',
    assets: ctx.assets,
    assetBaseUrl: ctx.assetBaseUrl,
    linkHref: links.hrefFor,
    trackOpens,
    trackClicks: ctx.trackClicks,
    preheader: ctx.preheader ?? normalized.doc.meta.previewText,
    rawNonce: ctx.rawNonce,
    preferenceCenterEnabled,
  });
  const renderedText = renderDocumentText({
    normalized,
    linkHref: links.hrefFor,
    preferenceCenterEnabled,
  });

  // AŽ TADY. React escapuje textové uzly, takže uvozovka vložená dřív
  // by se změnila na &quot; a Liquid by přestal být platný.
  const htmlSlots = applyFilterSlots(renderedHtml, normalized.filterSlots);
  const textSlots = applyFilterSlots(renderedText, normalized.filterSlots);
  const html = htmlSlots.output;
  const text = textSlots.output;

  const conditional = conditionalBlockIds(normalized.doc);
  const exemptSlots = new Set(
    normalized.filterSlots.filter((slot) => conditional.has(slot.blockId)).map((slot) => slot.slot),
  );

  const invariants = checkInvariants({
    html,
    text,
    links: links.links,
    trackOpens,
    purpose: ctx.purpose,
    filterSlots: normalized.filterSlots,
    usedSlots: new Set([...htmlSlots.used, ...textSlots.used]),
    unknownSlots: [...htmlSlots.unknown, ...textSlots.unknown],
    exemptSlots,
    rawPrefix: RAW_SLOT_PREFIX,
  });
  const fatal = invariants.issues.filter((issue) => issue.severity === 'error');
  if (fatal.length > 0) return { ok: false, issues: fatal };

  const schema = buildRenderSchema(normalized.doc, {
    fields: ctx.fields,
    skippedBlockIds: normalized.skippedBlockIds,
    preferenceCenterEnabled,
  });

  const meta: CompileMeta = {
    contractVersion: CONTRACT_VERSION,
    rendererVersion: RENDERER_VERSION,
    schemaVersion: normalized.doc.schemaVersion,
    usedPaths: schema.usedPaths,
    renderSchema: schema.renderSchema,
    links: links.links,
    assetIds: collectAssetIds(normalized.doc),
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    textBytes: Buffer.byteLength(text, 'utf8'),
    warnings: [
      ...normalized.warnings,
      ...links.warnings,
      ...invariants.issues.filter((issue) => issue.severity !== 'error'),
    ],
    hasUnsubscribeLink: schema.systemTags.includes('unsubscribe_url'),
    clickMarkerCount: invariants.clickMarkerCount,
    hasOpenPixelSlot: trackOpens,
  };

  return { ok: true, html, text, meta };
}

/**
 * ID bloků, které leží pod nějakou podmínkou zobrazení, včetně potomků.
 * Jejich sloty se v invariantu I10 nekontrolují: blok uvnitř `{% if %}` se
 * ve výstupu objevit nemusí, a to je v pořádku.
 */
export function conditionalBlockIds(doc: Document): Set<string> {
  const out = new Set<string>();
  type Node = { id: string; visibleWhen?: unknown; children?: Node[] };
  const visit = (block: Node, inherited: boolean): void => {
    const conditional = inherited || Boolean(block.visibleWhen);
    if (conditional) out.add(block.id);
    for (const child of block.children ?? []) visit(child, conditional);
  };
  for (const section of doc.blocks) visit(section as unknown as Node, false);
  return out;
}

function collectAssetIds(doc: Document): string[] {
  const ids = new Set<string>();
  type Node = { type: string; props?: Record<string, unknown>; children?: Node[] };
  const visit = (block: Node): void => {
    const props = block.props ?? {};
    for (const key of ['assetId', 'darkVariantAssetId', 'backgroundImageAssetId']) {
      const value = props[key];
      if (typeof value === 'string' && value !== '') ids.add(value);
    }
    for (const child of block.children ?? []) visit(child);
  };
  for (const section of doc.blocks) visit(section as unknown as Node);
  return [...ids];
}
