import { parseHTML } from 'linkedom';
import type { ParsedDocument } from './html';

export const MAX_LOGO_CANDIDATES = 8;
export const MIN_LOGO_SCORE = 60;

export type LogoFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'ico';
export type LogoCandidate = { url: string; priority: number };
export type MeasuredLogo = LogoCandidate & {
  format: LogoFormat;
  width: number;
  height: number;
  hasAlpha: boolean;
};

function absolute(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function collectLogoCandidates(parsed: ParsedDocument, baseUrl: string): LogoCandidate[] {
  const { document } = parsed;
  const candidates: LogoCandidate[] = [];

  const push = (href: string | null | undefined, priority: number) => {
    if (href === null || href === undefined) return;
    const url = absolute(href, baseUrl);
    if (url !== null && !candidates.some((c) => c.url === url)) {
      candidates.push({ url, priority });
    }
  };

  // 1: JSON-LD. Nejspolehlivější, protože je to explicitní tvrzení.
  for (const script of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    try {
      const data = JSON.parse(script.textContent ?? '') as Record<string, unknown>;
      const publisherLogo = (data['publisher'] as { logo?: { url?: string } } | undefined)?.logo
        ?.url;
      const logo = data['logo'] ?? publisherLogo;
      if (typeof logo === 'string') push(logo, 1);
      else if (typeof logo === 'object' && logo !== null && 'url' in logo) {
        push(String((logo as { url: unknown }).url), 1);
      }
    } catch {
      // Nevalidní JSON-LD se přeskočí.
    }
  }

  // 2: og:logo
  push(document.querySelector('meta[property="og:logo"]')?.getAttribute('content'), 2);

  // 3: obrázek v header nebo nav, jehož atributy obsahují „logo"
  for (const img of Array.from(document.querySelectorAll('header img, nav img'))) {
    const haystack = [
      img.getAttribute('src') ?? '',
      img.getAttribute('alt') ?? '',
      img.getAttribute('class') ?? '',
      img.getAttribute('id') ?? '',
    ]
      .join(' ')
      .toLowerCase();
    if (haystack.includes('logo')) push(img.getAttribute('src'), 3);
  }

  // 4 a 5: největší deklarovaná velikost první
  const bySize = (selector: string, priority: number) => {
    const links = Array.from(document.querySelectorAll(selector)).sort((a, b) => {
      const size = (el: Element) =>
        Number.parseInt(el.getAttribute('sizes')?.split('x')[0] ?? '0', 10);
      return size(b) - size(a);
    });
    for (const link of links) push(link.getAttribute('href'), priority);
  };
  bySize('link[rel~="apple-touch-icon"]', 4);
  bySize('link[rel~="icon"]', 5);

  // 6: poslední záchrana, typicky 32 px, pro e-mail nedostatečné
  push('/favicon.ico', 6);

  return candidates.slice(0, MAX_LOGO_CANDIDATES);
}

export function scoreLogo(logo: Omit<MeasuredLogo, 'url'>): number {
  let score = 100;
  if (logo.width >= 200) score += 40;
  else if (logo.width >= 120) score += 20;
  if (logo.width < 60) score -= 60;

  const ratio = logo.height === 0 ? 0 : logo.width / logo.height;
  if (ratio >= 1 && ratio <= 6) score += 25;
  if (ratio > 10 || ratio < 0.5) score -= 40;

  if (logo.hasAlpha) score += 15;
  if (logo.priority === 1 || logo.priority === 2) score += 20;
  if (logo.format === 'ico') score -= 30;
  return score;
}

export function selectLogo(candidates: readonly MeasuredLogo[]): {
  logo: MeasuredLogo | null;
  warnings: string[];
} {
  let best: { logo: MeasuredLogo; score: number } | null = null;
  for (const candidate of candidates) {
    const score = scoreLogo(candidate);
    if (best === null || score > best.score) best = { logo: candidate, score };
  }
  if (best === null || best.score <= MIN_LOGO_SCORE) {
    return { logo: null, warnings: ['logo_not_found'] };
  }
  return { logo: best.logo, warnings: [] };
}

const ALLOWED_SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'title',
  'desc',
]);

const ALLOWED_SVG_ATTRS = new Set([
  'viewbox',
  'width',
  'height',
  'xmlns',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'points',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'clip-path',
  'mask',
  'id',
  'class',
]);

/**
 * Prvky, které se zahazují VČETNĚ obsahu. U ostatních nepovolených prvků se
 * obsah zachová a zmizí jen obal.
 *
 * Důvod je praktický: `<a>` se v HTML parseru nedá uzavřít lomítkem, takže
 * `<a href="x"/><rect/>` skončí s obdélníkem UVNITŘ odkazu. Kdyby se odkaz
 * mazal i s obsahem, zmizela by celá kresba loga a zůstalo by prázdné `<svg/>`.
 */
const HARD_DROP_SVG_TAGS = new Set([
  'script',
  'style',
  'foreignobject',
  'image',
  'use',
  'iframe',
  'audio',
  'video',
  'animate',
  'animatetransform',
  'set',
  'handler',
]);

export type SvgSanitizeResult = { ok: true; svg: string } | { ok: false; reason: string };

/**
 * SVG je nejčastější formát loga na webu, ale jako vstup je nebezpečné: může
 * obsahovat skript, externí odkazy i XXE. Sanitizace je allowlist prvků
 * i atributů, ne blocklist.
 */
export function sanitizeSvg(input: string): SvgSanitizeResult {
  // Dokument s ENTITY v prologu se rovnou odmítá, je to XXE.
  if (/<!ENTITY/i.test(input)) return { ok: false, reason: 'entity_in_prolog' };

  /*
   * SVG je XML, ale parsuje se HTML parserem, který samouzavírací značky
   * nezná: z `<a href="x"/><rect/>` mu vyjde obdélník UVNITŘ odkazu a odstranění
   * odkazu by smazalo celou kresbu. Samouzavírací značky se proto nejdřív
   * rozepíšou na pár, ať zůstanou sourozenci sourozenci.
   */
  const normalized = input.replace(
    /<([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)\/>/g,
    '<$1$2></$1>',
  );

  const { document } = parseHTML(`<html><body><div>${normalized}</div></body></html>`);
  const root = document.querySelector('svg');
  if (root === null) return { ok: false, reason: 'not_svg' };

  for (const element of Array.from(root.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) {
      if (!HARD_DROP_SVG_TAGS.has(tag)) {
        const parent = element.parentNode;
        while (parent !== null && element.firstChild !== null) {
          parent.insertBefore(element.firstChild, element);
        }
      }
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'href' || name === 'xlink:href') {
        // Povolený je jen interní fragment.
        if (!attribute.value.startsWith('#')) element.removeAttribute(attribute.name);
        continue;
      }
      if (!ALLOWED_SVG_ATTRS.has(name)) element.removeAttribute(attribute.name);
    }
  }

  return { ok: true, svg: root.outerHTML };
}
