import type { PublicPageDesign } from '@mlain/core/contacts';
import { renderPageHtml } from '@mlain/emails/emitter/render-page';
import { publicHtmlResponse } from './render';

/**
 * NAVRŽENÁ VEŘEJNÁ STRÁNKA, tedy dokument z Builderu místo vestavěné věty.
 *
 * Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md,
 * oddíly 0.1, 2.3 a 4.2.
 *
 * DOKUMENT NAHRAZUJE CELOU BÍLOU KARTU, ne jen její obsah (rozhodnutí zadavatele
 * 0.1). Proto se sem NEDÁVÁ `PublicLayout`: `renderPageHtml` vrací celou stránku
 * včetně `<html>`, `noindex` a stylů vložených do značek, takže obal aplikace by
 * autorovi jen vnutil kartu, kterou si nevybral. Jméno odesílatele je z téhož
 * důvodu obyčejný textový blok v předloze, ne součást obalu.
 *
 * Dnešní pravidla veřejných stránek platí i tady a nese je emitor:
 *   - žádný JavaScript a žádný odkaz na externí soubor (`PageShell`),
 *   - `noindex` ve značce i v hlavičce odpovědi (`publicHtmlResponse`),
 *   - rozpočet 100 kB hlídá test, obrázky jdou přes naše úložiště.
 *
 * PÁD VYKRESLENÍ NENÍ CHYBA STRÁNKY, JE TO NÁVRAT K VESTAVĚNÉMU TEXTU.
 * Vrací se `null` a volající vykreslí dnešní větu. Když se sem trasa dostane,
 * je vedlejší účinek (potvrzení, odhlášení) už zapsaný a chybová stránka by
 * člověka poslala klikat na odkaz z e-mailu znovu, tedy dělat něco, co je
 * hotové. Návrh smí ovlivnit vzhled, nikdy ne to, co se stalo.
 */
export async function renderDesignedPage(
  design: PublicPageDesign | null,
  /** Viz `embeddable` u `publicHtmlResponse`. Děkovací stránka formuláře běží v rámu. */
  options: { embeddable?: boolean } = {},
): Promise<Response | null> {
  if (design === null) return null;
  try {
    const html = await renderPageHtml({
      document: design.document,
      data: design.data,
      language: design.language,
      assets: design.assets,
      assetBaseUrl: design.assetBaseUrl,
    });
    return publicHtmlResponse(
      html,
      options.embeddable === undefined ? {} : { embeddable: options.embeddable },
    );
  } catch (error) {
    console.error('Návrh veřejné stránky se nevykreslil, použije se vestavěný text.', error);
    return null;
  }
}
