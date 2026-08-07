import { createHtmlEngine } from '@mlain/contracts/liquid/engine';
import { prepareRenderData, type RenderData } from '@mlain/contracts/liquid/prepare-render-data';
import { applyFilterSlots } from '../compile/apply-slots';
import { buildRenderSchema } from '../compile/render-schema';
import type { AssetRef } from '../compile/types';
import type { Document } from '../document/types';
import { normalizeDocument } from '../normalize/index';
import { renderDocumentHtml } from './render';

export type PageRenderOptions = {
  /**
   * Dokument stránky. MOTIV SE BERE Z NĚJ, stejně jako u e-mailu: barvy a písma
   * jsou vlastnost dokumentu, ne argument vykreslení, takže náhled v editoru
   * a stránka u návštěvníka nemůžou vyjít jinak.
   */
  document: Document;
  /**
   * Hodnoty proměnných, tedy `contact`, `workspace` a `data` (viz `page-surfaces`).
   *
   * Vynechání nechá ve výstupu Liquid výrazy nedosazené. Chce to jenom ten, kdo
   * si výsledek ukládá k pozdějšímu dosazení; návštěvníkovi se takový výstup
   * poslat nesmí, viděl by `{{ contact.greeting }}`.
   */
  data?: RenderData | undefined;
  /** Jazyk dodávaných textů. Vynechání znamená jazyk dokumentu. */
  language?: string | undefined;
  assets?: Record<string, AssetRef> | undefined;
  assetBaseUrl?: string | undefined;
  /** Jen pro testy. V produkci se nikdy nepředává. */
  rawNonce?: string | undefined;
};

/**
 * Vykreslí dokument jako VEŘEJNOU STRÁNKU, tedy s `PageShell` místo `EmailShell`.
 *
 * Je to obdoba `renderDocumentHtml`, ne druhá cesta: uvnitř volá tentýž render
 * s volbou `shell: 'page'` a dělá k tomu dva kroky navíc, které u e-mailu
 * obstarává kompilace.
 *
 * 1. DOSADÍ ARGUMENTY FILTRŮ. Bez toho by ve výstupu zůstaly žetony `ML_ARG_`
 *    a Liquid by na `{{ contact.first_name | default: ML_ARG_0001 }}` spadl na
 *    neznámé proměnné, tedy tiše na prázdný řetězec.
 * 2. DOSADÍ HODNOTY, když je volající předá. Mapu `_present` skládá
 *    `prepareRenderData` z téhož schématu, jaké vydá kompilace, aby se
 *    podmíněné bloky na stránce chovaly stejně jako v e-mailu.
 *
 * Sledování otevření ani prokliků se nezapíná: za stránkou nestojí žádná
 * kampaň, které by se událost připsala, a pixel v HTML by byl jen značka,
 * kterou nikdo nezpracuje.
 */
export async function renderPageHtml(options: PageRenderOptions): Promise<string> {
  const normalized = normalizeDocument(options.document, {
    language: options.language ?? options.document.meta.language,
  });

  const rendered = await renderDocumentHtml({
    normalized,
    shell: 'page',
    assets: options.assets ?? {},
    assetBaseUrl: options.assetBaseUrl ?? '',
    linkHref: (href: string) => href,
    trackOpens: false,
    trackClicks: false,
    rawNonce: options.rawNonce,
  });

  const html = applyFilterSlots(rendered, normalized.filterSlots).output;
  if (options.data === undefined) return html;

  // Katalog polí je prázdný schválně: `buildRenderSchema` ho používá jen
  // k typu pole v `renderSchema.fields`, kdežto tady je potřeba pouze seznam
  // `presence`. Vyžadovat kvůli tomu celý katalog by znamenalo, že veřejná
  // trasa musí sáhnout do databáze pro data, která k vykreslení nepotřebuje.
  const schema = buildRenderSchema(normalized.doc, {
    fields: { fields: [], version: '' },
    skippedBlockIds: normalized.skippedBlockIds,
  });
  const prepared = prepareRenderData(options.data, {
    fields: schema.usedPaths,
    presence: schema.presence,
  });
  return createHtmlEngine().parseAndRender(html, prepared);
}
