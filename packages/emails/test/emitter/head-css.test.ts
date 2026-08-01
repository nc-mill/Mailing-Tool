import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../src/document/defaults';
import { resolveTheme } from '../../src/theme/resolve';
import { buildHeadCss, MSO_HEAD_BLOCK } from '../../src/emitter/head-css';

describe('head css', () => {
  it('contains the fixed client reset', () => {
    const css = buildHeadCss(resolveTheme(DEFAULT_THEME));
    expect(css).toContain('body{margin:0;padding:0;width:100%!important');
    expect(css).toContain('table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}');
    expect(css).toContain('u+#body a{color:inherit;text-decoration:none}');
  });

  it('derives the breakpoint from contentWidth', () => {
    expect(buildHeadCss(resolveTheme(DEFAULT_THEME))).toContain(
      '@media only screen and (max-width:600px)',
    );
    expect(buildHeadCss(resolveTheme({ ...DEFAULT_THEME, contentWidth: 640 }))).toContain(
      '@media only screen and (max-width:640px)',
    );
  });

  it('derives mobile heading sizes from the theme, not from constants', () => {
    const base = buildHeadCss(resolveTheme(DEFAULT_THEME));
    expect(base).toContain('.ml-h1{font-size:26px!important;line-height:1.2!important}');
    const big = buildHeadCss(
      resolveTheme({
        ...DEFAULT_THEME,
        typography: { baseFontSize: 20, baseLineHeight: 1.5, headingScale: 1.25 },
      }),
    );
    // Odchylka od plánu: tvrzení je uvázané na pravidlo `.ml-h1`. Holý podřetězec
    // `font-size:26px` sedí i na `.ml-h2` většího motivu, takže by test prošel,
    // i kdyby byla velikost nadpisu 1 natvrdo zapsaná konstanta.
    expect(big).not.toContain('.ml-h1{font-size:26px!important;line-height:1.2!important}');
    expect(big).toContain('.ml-h1{font-size:33px!important;line-height:1.2!important}');
  });

  it('emits the dark block from the theme dark palette', () => {
    const css = buildHeadCss(
      resolveTheme({
        ...DEFAULT_THEME,
        darkMode: { strategy: 'auto', colors: { 'surface.content': '#123456' } },
      }),
    );
    expect(css).toContain('@media (prefers-color-scheme:dark)');
    expect(css).toContain('.ml-content{background-color:#123456!important}');
    expect(css).toContain('[data-ogsb] .ml-content{background-color:#123456!important}');
  });

  it('omits the dark block when the strategy is off', () => {
    const css = buildHeadCss(
      resolveTheme({ ...DEFAULT_THEME, darkMode: { strategy: 'off', colors: {} } }),
    );
    expect(css).not.toContain('prefers-color-scheme:dark');
    expect(css).not.toContain('data-ogsc');
  });

  it('never emits an at font face rule', () => {
    expect(buildHeadCss(resolveTheme(DEFAULT_THEME))).not.toContain('@font-face');
  });

  it('ships the mso office document settings block', () => {
    expect(MSO_HEAD_BLOCK).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
    expect(MSO_HEAD_BLOCK).toContain('<o:AllowPNG/>');
    expect(MSO_HEAD_BLOCK.startsWith('<!--[if mso]>')).toBe(true);
  });
});
