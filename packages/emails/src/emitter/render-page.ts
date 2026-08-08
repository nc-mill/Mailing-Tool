import { createHtmlEngine } from '@mlain/contracts/liquid/engine';
import { prepareRenderData, type RenderData } from '@mlain/contracts/liquid/prepare-render-data';
import { applyFilterSlots } from '../compile/apply-slots';
import { conditionalBlockIds } from '../compile/compile';
import { checkInvariants } from '../compile/invariants';
import { buildRenderSchema } from '../compile/render-schema';
import type { AssetRef } from '../compile/types';
import type { Document } from '../document/types';
import { normalizeDocument } from '../normalize/index';
import { RAW_SLOT_PREFIX } from '../normalize/slots';
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

  const slots = applyFilterSlots(rendered, normalized.filterSlots);
  const html = slots.output;
  const conditional = conditionalBlockIds(normalized.doc);

  // INVARIANTY PLATÍ I PRO STRÁNKU, ne jen pro e-mail.
  //
  // Do téhle chvíle je nekontroloval nikdo: `compileDocument` je pouští, jenže
  // veřejná trasa jde přímo sem a kompilaci míjí. Vypadlo tím mimo jiné I6,
  // tedy jediná kontrola, která hlídá `javascript:` a `<script>` v hotovém
  // výstupu, a to zrovna na stránce, která běží NA NAŠÍ DOMÉNĚ. V e-mailu
  // by skript stejně nespustil žádný poštovní klient, tady ano.
  //
  // Kontroluje se PŘED dosazením hodnot: Liquid se u stránky vykresluje až
  // nad hotovým HTML, takže potom už by konstrukce nebyly vidět a I1 by
  // neměla co ověřovat.
  const invariants = checkInvariants({
    html,
    // Stránka nemá textovou variantu, tu má jen e-mail.
    text: '',
    // Odkazy se na stránce nesledují, takže žádná značka prokliku vzniknout
    // nesmí. Prázdný seznam z toho dělá ověřitelné tvrzení, ne domněnku: I3
    // ohlásí každou značku, která se do výstupu přesto dostala.
    links: [],
    trackOpens: false,
    // Výstup jde návštěvníkovi, ne do náhledu, takže platí i zákaz editorových
    // atributů. Emitor je nevydává, ale kdyby začal, pozná se to tady.
    purpose: 'send',
    filterSlots: normalized.filterSlots,
    usedSlots: new Set(slots.used),
    unknownSlots: [...slots.unknown],
    exemptSlots: new Set(
      normalized.filterSlots
        .filter((slot) => conditional.has(slot.blockId))
        .map((slot) => slot.slot),
    ),
    rawPrefix: RAW_SLOT_PREFIX,
  });
  const fatal = invariants.issues.filter((issue) => issue.severity === 'error');
  if (fatal.length > 0) {
    // Výjimka, ne tichá oprava: volající (`renderDesignedPage`) ji zachytí
    // a vykreslí vestavěný text. Podezřelou stránku je lepší nevydat vůbec
    // než ji vydat opravenou způsobem, který nikdo neviděl.
    throw new Error(`Stránka neprošla invarianty: ${fatal.map((issue) => issue.code).join(', ')}`);
  }

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
