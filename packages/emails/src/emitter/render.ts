import { OPEN_PIXEL_MARKER } from '@mlain/contracts/markers';
import { render } from '@react-email/render';
import { createElement } from 'react';
import type { AssetRef } from '../compile/types';
import { applyRawSlots } from '../compile/apply-slots';
import type { NormalizedDocument } from '../normalize/index';
import { RawSlotSink } from '../normalize/slots';
import { SectionBlockView } from './blocks/section';
import { EmitterProvider, type EmitterState } from './ctx';
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
  };

  const tree = createElement(
    EmitterProvider,
    { value: state },
    createElement(
      EmailShell,
      {
        language: normalized.doc.meta.language,
        title: normalized.doc.meta.name,
        preheader: options.preheader ?? normalized.doc.meta.previewText,
      },
      ...normalized.doc.blocks.map((section) =>
        createElement(SectionBlockView, { key: section.id, block: section }),
      ),
    ),
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
