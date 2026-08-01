import type { ResolvedTheme } from '../theme/resolve';

/**
 * Reset klienta, pevný a neměnný (3.4.5). Bez `@font-face`, ten v e-mailu
 * nefunguje a jen zvětšuje HTML.
 */
const RESET = [
  'body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}',
  'table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}',
  'img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}',
  'a{text-decoration:underline}',
  '.ml-body a{color:inherit}',
  'u+#body a{color:inherit;text-decoration:none}',
].join('');

/**
 * Bez tohohle bloku Outlook při systémovém škálování nad 100 % zvětší obrázky
 * a rozloží layout. Emituje se přes raw slot, protože React komentář nevypustí.
 */
export const MSO_HEAD_BLOCK =
  '<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/>' +
  '<o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->';

export function buildHeadCss(theme: ResolvedTheme): string {
  const parts: string[] = [RESET];
  parts.push(':root{color-scheme:light dark;supported-color-schemes:light dark}');

  const media = [
    `.ml-col{display:block!important;width:100%!important;max-width:100%!important}`,
    `.ml-hide-m{display:none!important}`,
    `.ml-pad{padding-left:${theme.mobile.pad}px!important;padding-right:${theme.mobile.pad}px!important}`,
    `.ml-h1{font-size:${theme.mobile.headingSize(1)}px!important;line-height:${theme.mobile.headingLineHeight}!important}`,
    `.ml-h2{font-size:${theme.mobile.headingSize(2)}px!important;line-height:${theme.mobile.headingLineHeight}!important}`,
    `.ml-h3{font-size:${theme.mobile.headingSize(3)}px!important;line-height:${theme.mobile.headingLineHeight}!important}`,
    `.ml-btn{width:100%!important}`,
  ].join('');
  parts.push(`@media only screen and (max-width:${theme.mobile.breakpoint}px){${media}}`);

  if (theme.darkModeEnabled) {
    const dark = theme.dark.roles;
    const rules = [
      `.ml-canvas{background-color:${dark['surface.canvas']}!important}`,
      `.ml-content{background-color:${dark['surface.content']}!important}`,
      `.ml-text{color:${dark['text.default']}!important}`,
      `.ml-muted{color:${dark['text.muted']}!important}`,
      `.ml-link{color:${dark['link.default']}!important}`,
      `.ml-logo-light{display:none!important}`,
      `.ml-logo-dark{display:block!important;max-height:none!important;overflow:visible!important}`,
    ].join('');
    parts.push(`@media (prefers-color-scheme:dark){${rules}}`);
    // Outlook.com injektuje data-ogsc a data-ogsb při renderu v tmavém režimu.
    parts.push(
      `[data-ogsc] .ml-text{color:${dark['text.default']}!important}` +
        `[data-ogsc] .ml-muted{color:${dark['text.muted']}!important}` +
        `[data-ogsc] .ml-link{color:${dark['link.default']}!important}` +
        `[data-ogsb] .ml-canvas{background-color:${dark['surface.canvas']}!important}` +
        `[data-ogsb] .ml-content{background-color:${dark['surface.content']}!important}`,
    );
  }
  return parts.join('');
}
