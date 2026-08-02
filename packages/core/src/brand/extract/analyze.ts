import { collectColorCandidates, collectTypographyCandidates } from './css';
import {
  collectInlineCss,
  collectStylesheetUrls,
  parseDocument,
  readThemeColor,
  extractVisibleText,
} from './html';
import { collectLogoCandidates, type LogoCandidate } from './logo';
import { buildPalette, type BrandPalette } from './palette';
import { mapFontStack, medianRadius, type BrandTypography } from './typography';

export type BrandAsset = { url: string; body: Buffer };

export type BrandAnalysis = {
  palette: BrandPalette;
  typography: BrandTypography;
  logoCandidates: LogoCandidate[];
  visibleText: string;
  warnings: string[];
};

const CSS_LIKE = /\.css(\?|$)/i;

/**
 * Čistá analýza stažené stránky: z HTML a stažených souborů odvodí paletu,
 * písmo a kandidáty na logo.
 *
 * Vědomě NEMĚŘÍ obrázky a nic neukládá. Měření rozměrů a alfa kanálu potřebuje
 * `sharp` a uložení loga potřebuje úložiště assetů; obojí je mimo tenhle modul,
 * takže se vrací jen kandidáti a varování `logo_not_measured`.
 */
export function analyzePage(params: {
  html: string;
  finalUrl: string;
  assets: readonly BrandAsset[];
}): BrandAnalysis {
  const parsed = parseDocument(params.html);
  const warnings: string[] = [];

  const stylesheetUrls = new Set(collectStylesheetUrls(parsed, params.finalUrl));
  const externalCss = params.assets
    .filter((asset) => stylesheetUrls.has(asset.url) || CSS_LIKE.test(asset.url))
    .map((asset) => asset.body.toString('utf8'))
    .join('\n');

  const css = [collectInlineCss(params.html), externalCss].join('\n');

  const colors = collectColorCandidates(css, { themeColor: readThemeColor(parsed) });
  if (colors.length === 0) warnings.push('colors_not_found');

  const palette = buildPalette(colors);

  const { fontFamilies, radii } = collectTypographyCandidates(css);
  if (fontFamilies.length === 0) warnings.push('fonts_not_found');

  const typography: BrandTypography = {
    // První deklarace `font-family` v CSS bývá na `body` nebo `:root`, takže
    // popisuje běžný text. Nadpisy se berou z poslední, když se liší.
    bodyStack: mapFontStack(fontFamilies[0]),
    headingStack: mapFontStack(fontFamilies.at(-1) ?? fontFamilies[0]),
    radius: medianRadius(radii),
  };

  const logoCandidates = collectLogoCandidates(parsed, params.finalUrl);
  // Bez měření rozměrů se logo nedá vybrat podle skóre, takže se jen ohlásí,
  // že výběr zůstal na později.
  warnings.push('logo_not_measured');

  return {
    palette,
    typography,
    logoCandidates,
    visibleText: extractVisibleText(parseDocument(params.html)),
    warnings,
  };
}
