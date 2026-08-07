import { OPEN_PIXEL_MARKER } from '@mlain/contracts/markers';
import { render } from '@react-email/render';
import { createElement } from 'react';
import type { AssetRef } from '../compile/types';
import { applyRawSlots } from '../compile/apply-slots';
import type { NormalizedDocument } from '../normalize/index';
import { RawSlotSink } from '../normalize/slots';
import { SectionBlockView } from './blocks/section';
import type { EmitterState } from './ctx';
import { PageShell } from './page-shell';
import { EmailShell } from './shell';

export type RenderOptions = {
  normalized: NormalizedDocument;
  assets: Record<string, AssetRef>;
  assetBaseUrl: string;
  /** Mapuje href na značku odkazu. Sestavuje ji collectLinks. */
  linkHref: (href: string, trackable: boolean) => string;
  trackOpens: boolean;
  trackClicks: boolean;
  preheader?: string | undefined;
  /** Jen pro testy. V produkci se nikdy nepředává. */
  rawNonce?: string | undefined;
  /** Nabízí projekt centrum předvoleb? Vynechání znamená ano, viz `EmitterState`. */
  preferenceCenterEnabled?: boolean | undefined;
  /**
   * Obal dokumentu. Vynechání znamená e-mail.
   *
   * Je to VOLBA V TÉTO CESTĚ, ne druhá vykreslovací cesta. Bloky, motiv, sloty
   * i deterministické úpravy výstupu jsou pro stránku a pro e-mail tytéž;
   * kdyby si stránka nesla vlastní render, rozešly by se v první opravě, která
   * by se udělala jen v jednom z nich.
   */
  shell?: 'email' | 'page' | undefined;
};

/** Texty dodávané produktem. Zatím jen oddělovače prostého textu, patička je v props bloku. */
const PRODUCT_TEXTS: Record<string, Record<string, string>> = {
  cs: { 'text.unsubscribe': 'Odhlásit se z odběru', 'text.webview': 'Zobrazit v prohlížeči' },
  en: { 'text.unsubscribe': 'Unsubscribe', 'text.webview': 'View in browser' },
};

export async function renderDocumentHtml(options: RenderOptions): Promise<string> {
  const { normalized } = options;
  const raw = new RawSlotSink(options.rawNonce);
  const state: EmitterState = {
    theme: normalized.theme,
    raw,
    assets: options.assets,
    assetBaseUrl: options.assetBaseUrl,
    language: normalized.language,
    skippedBlockIds: normalized.skippedBlockIds,
    trackClicks: options.trackClicks,
    linkHref: options.linkHref,
    t: (key: string) => PRODUCT_TEXTS[normalized.language]?.[key] ?? PRODUCT_TEXTS.en![key] ?? key,
    preferenceCenterEnabled: options.preferenceCenterEnabled,
  };

  // Stav prochází stromem jako vlastnost `emitter`, ne React kontextem.
  // Důvod je v komentáři u `EmitterState`.
  const sections = normalized.doc.blocks.map((section) =>
    createElement(SectionBlockView, { key: section.id, block: section, emitter: state }),
  );
  const shellProps = {
    emitter: state,
    language: normalized.doc.meta.language,
    title: normalized.doc.meta.name,
  };
  // Větev, ne jeden `createElement` s nepovinným preheaderem: `PageShell`
  // vlastnost `preheader` vůbec nemá a povinná v `EmailShell` zůstat musí,
  // jinak by e-mail mohl odejít bez textu, který schránka ukazuje v seznamu.
  const tree =
    options.shell === 'page'
      ? createElement(PageShell, shellProps, ...sections)
      : createElement(
          EmailShell,
          { ...shellProps, preheader: options.preheader ?? normalized.doc.meta.previewText },
          ...sections,
        );

  let html = await render(tree);
  // D5: React vkládá mezi dva sousední textové uzly oddělovač. Náš vlastní
  // podmíněný komentář má vždy tvar `<!--[if ...`, takže je záměna bezpečná.
  html = html.replaceAll('<!-- -->', '');
  // D3: teprve teď se dosadí syrové HTML.
  html = applyRawSlots(html, raw);
  // Odchylka od plánu: značka pixelu se vkládá záměnou řetězce, ne uzlem stromu.
  // Kontrakt ji chce přesně před `</body>`, ale `Body` z react-emailu obaluje
  // obsah vlastní tabulkou, takže uzel ve stromu vždy skončí uvnitř `<td>`.
  // Je to čtvrtá deterministická úprava téhož druhu jako D3 až D5.
  if (options.trackOpens) html = html.replace('</body>', `${OPEN_PIXEL_MARKER}</body>`);
  // D4: kontrakt slibuje senderu kompletní dokument začínající `<!DOCTYPE html>`.
  html = html.replace(/^<!DOCTYPE[^>]*>/i, '<!DOCTYPE html>');
  return html;
}
