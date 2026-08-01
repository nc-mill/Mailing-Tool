import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document } from '../../src/document/types';
import { normalizeDocument } from '../../src/normalize/index';
import { resolveTheme } from '../../src/theme/resolve';
import { buildHeadCss } from '../../src/emitter/head-css';
import { renderDocumentHtml } from '../../src/emitter/render';

const doc = (over: Partial<Document> = {}): Document =>
  ({
    schemaVersion: 1,
    meta: { name: 'Letní výprodej', previewText: 'Slevy končí v neděli', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [
          {
            id: 'b_000000000002',
            type: 'text',
            props: {
              ...blockDefaults('text'),
              content: [{ t: 'p', children: [{ t: 's', v: 'Ahoj' }] }],
            },
          },
        ],
      },
    ],
    ...over,
  }) as Document;

const run = (input: Document, over: Record<string, unknown> = {}) =>
  renderDocumentHtml({
    normalized: normalizeDocument(input, { language: input.meta.language }),
    assets: {},
    assetBaseUrl: 'https://assets.test',
    linkHref: (href: string) => href,
    trackOpens: true,
    trackClicks: true,
    rawNonce: 'ab12cd34ef',
    ...over,
  });

describe('renderDocumentHtml', () => {
  it('emits a short html5 doctype, not the xhtml one react-email defaults to', async () => {
    const html = await run(doc());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toContain('XHTML 1.0 Transitional');
  });

  it('carries the vml namespaces and the language on the html element', async () => {
    const html = await run(doc());
    expect(html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(html).toContain('xmlns:o="urn:schemas-microsoft-com:office:office"');
    expect(html).toContain('lang="cs"');
  });

  it('keeps an unknown language tag on the html element even though texts fall back', async () => {
    const html = await run(doc({ meta: { name: 'x', previewText: '', language: 'sv-FI' } }));
    expect(html).toContain('lang="sv-FI"');
  });

  it('puts the office document settings and the whole css in the head', async () => {
    const html = await run(doc());
    expect(html).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
    expect(html).toContain('@media only screen and (max-width:600px)');
    // Odchylka od plánu: plán tu hlídal `"Segoe UI"` uvnitř <style>. Font stack ale
    // v hlavičce vůbec není, motiv ho píše jen inline, takže by tvrzení nešlo splnit.
    // Kontroluje se proto silnější věc: obsah <style> je bajtově tentýž řetězec,
    // jaký vydal buildHeadCss. To chytí jak escapování Reactem, tak zploštění uzlu.
    const style = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));
    expect(style).toBe(buildHeadCss(resolveTheme(DEFAULT_THEME)));
  });

  it('emits the color scheme meta tags', async () => {
    expect(await run(doc())).toContain('<meta name="color-scheme" content="light dark"');
    const off = await run(
      doc({ theme: { ...DEFAULT_THEME, darkMode: { strategy: 'off', colors: {} } } }),
    );
    expect(off).toContain('<meta name="color-scheme" content="light"');
  });

  it('emits the preheader as hidden text with filler', async () => {
    const html = await run(doc(), { preheader: 'Slevy končí v neděli' });
    expect(html).toContain('Slevy končí v neděli');
    expect(html).toContain('mso-hide:all');
    expect(html).toContain('max-height:0');
  });

  it('emits exactly one open pixel marker right before the closing body tag', async () => {
    const html = await run(doc());
    expect(html.split('<!--ML_OPEN_PIXEL-->').length - 1).toBe(1);
    expect(html).toContain('<!--ML_OPEN_PIXEL--></body>');
  });

  it('emits no open pixel marker when tracking of opens is off', async () => {
    expect(await run(doc(), { trackOpens: false })).not.toContain('ML_OPEN_PIXEL');
  });

  it('leaves no raw slot marker behind', async () => {
    expect(await run(doc())).not.toContain('ML_RAW_');
  });

  it('removes the react text separators', async () => {
    expect(await run(doc())).not.toContain('<!-- -->');
  });

  it('is byte identical across two runs with the same input', async () => {
    const a = await run(doc());
    const b = await run(doc());
    expect(a).toBe(b);
  });
});
