import { describe, expect, it } from 'vitest';
import { compileDocument } from '../../src/compile/compile';
import type { CompileContext } from '../../src/compile/types';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import { renderPageHtml } from '../../src/emitter/render-page';
import type { Document } from '../../src/document/types';

/**
 * VRSTVY 2 a 3 ze tří.
 *
 * Vrstva 2: `renderPageHtml` pouští invarianty, takže se na veřejnou stránku
 * uplatní I6, tedy jediná kontrola nebezpečného obsahu nad HOTOVÝM výstupem.
 * Vrstva 3: emitor degraduje neznámé schéma na `#`, takže se do atributu
 * nedostane ani tehdy, kdyby validaci někdo obešel.
 *
 * Validace dokumentu se tady schválně NEVOLÁ. Obě vrstvy mají smysl právě
 * v okamžiku, kdy validace neproběhla nebo ji někdo obešel starým dokumentem.
 */

const ASSET = '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071';

const docOf = (children: unknown[]): Document =>
  ({
    schemaVersion: 1,
    meta: { name: 'Děkujeme', previewText: 'náhled', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [{ id: 'b_000000000001', type: 'section', props: blockDefaults('section'), children }],
  }) as Document;

const button = (href: string) => ({
  id: 'b_000000000002',
  type: 'button',
  props: { ...blockDefaults('button'), href, trackable: true },
});

const textLink = (href: string) => ({
  id: 'b_000000000003',
  type: 'text',
  props: {
    ...blockDefaults('text'),
    content: [{ t: 'p', children: [{ t: 'a', href, children: [{ t: 's', v: 'klik' }] }] }],
  },
});

const socialWith = (href: string) => ({
  id: 'b_000000000004',
  type: 'social',
  props: { ...blockDefaults('social'), items: [{ network: 'facebook', href }] },
});

const imageWith = (href: string) => ({
  id: 'b_000000000005',
  type: 'image',
  props: { ...blockDefaults('image'), assetId: ASSET, alt: 'Logo', href },
});

const htmlWith = (code: string) => ({
  id: 'b_000000000006',
  type: 'html',
  props: { ...blockDefaults('html'), code },
});

const compileCtx: CompileContext = {
  workspaceId: '019fc763-7184-72dd-a48d-3cf3ec306179',
  campaignId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6072',
  templateKind: 'campaign',
  fields: { version: 'test', fields: [] } as unknown as CompileContext['fields'],
  language: 'cs',
  assetBaseUrl: 'https://priklad.cz',
  assets: {},
  purpose: 'send',
  trackOpens: false,
  trackClicks: true,
  currentYear: 2026,
  rawNonce: 'ab12cd34ef',
};

const page = (children: unknown[]) => renderPageHtml({ document: docOf(children), rawNonce: 'ab' });

describe('vrstva 3: emitor degraduje neznámé schéma na #', () => {
  it('nepustí javascript: do atributu tlačítka, ani s Liquidem za sebou', async () => {
    const html = await page([button('javascript:alert(document.domain)#{{ x }}')]);
    expect(html).not.toContain('javascript:');
    // Tlačítko zůstane tlačítkem, jen nikam nevede. Rozbije se jeden prvek,
    // ne celá stránka, na kterou návštěvník přišel z odhlašovacího odkazu.
    expect(html).toContain('href="#"');
  });

  it('nepustí ho ani do odkazu v textu, do obrázku a do sociální ikony', async () => {
    const html = await page([
      textLink('{{ x }}javascript:alert(1)'),
      socialWith('vbscript:msgbox(1)'),
      imageWith('data:text/html,<script>alert(1)</script>'),
    ]);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('vbscript:');
    expect(html).not.toContain('data:text/html');
  });

  it('platí i pro e-mail, ne jen pro stránku', async () => {
    const result = await compileDocument(docOf([button('javascript:alert(1)#{{ x }}')]), {
      ...compileCtx,
      purpose: 'preview',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toContain('javascript:');
    // Ve VML variantě pro Outlook je href podruhé, takže se hlídají obě.
    expect(result.html.match(/href="#"/g)?.length).toBe(2);
  });

  it('nechá legitimní odkazy beze změny, včetně značky sledovaného prokliku', async () => {
    const result = await compileDocument(
      docOf([
        button('https://priklad.cz/dal'),
        textLink('{{ unsubscribe_url }}'),
        socialWith('mailto:podpora@priklad.cz'),
      ]),
      { ...compileCtx, purpose: 'preview' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sledovaný odkaz se mění na značku, ne na `#`: značka je povolené https.
    expect(result.html).toContain('https://track.mlain.invalid/c/');
    expect(result.html).toContain('{{ unsubscribe_url }}');
    expect(result.html).toContain('mailto:podpora@priklad.cz');
    expect(result.html).not.toContain('href="#"');
  });

  it('nechá beze změny relativní odkaz i odkaz složený z proměnné', async () => {
    const html = await page([button('{{ data.confirm_url }}'), textLink('/dekujeme')]);
    expect(html).toContain('{{ data.confirm_url }}');
    expect(html).toContain('href="/dekujeme"');
  });
});

describe('vrstva 2: vykreslení stránky pouští invarianty', () => {
  // Syrové HTML je jediná cesta, kterou vrstva 3 nehlídá: `href` v cizím
  // markupu neskládá emitor, ale autor bloku. Sanitizace ho pustí, protože
  // `jav{{ … }}ascript:` pro ni není schéma, a schéma z toho vznikne teprve
  // vykreslením Liquidu NAD hotovým HTML. Blok `html` je na stránce zakázaný
  // validací, jenže veřejná trasa jde přímo do vykreslení a validaci míjí.
  const smuggled = '<a href="jav{{ contact.attr.city }}ascript:alert(1)">klik</a>';

  it('odmítne stránku, ve které by po dosazení Liquidu vzniklo javascript:', async () => {
    await expect(page([htmlWith(smuggled)])).rejects.toThrow('render_forbidden_content');
  });

  it('odmítne i schéma, které je v syrovém HTML napsané rovnou', async () => {
    // Sanitizace tenhle tvar odstraní, takže test hlídá obojí: buď href zmizí,
    // nebo invariant stránku zastaví. Co nesmí nastat je, že projde ven.
    const html = await page([htmlWith('<a href="{{ x }}javascript:alert(1)">klik</a>')]).catch(
      (error: Error) => error.message,
    );
    expect(html).toContain('render_forbidden_content');
  });

  it('propustí normální stránku beze změny chování', async () => {
    const html = await page([button('https://priklad.cz/dal'), textLink('/dekujeme')]);
    expect(html).toContain('https://priklad.cz/dal');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('e-mail chytá totéž, protože I6 čte i výstup bez konstrukcí Liquidu', async () => {
    const result = await compileDocument(docOf([htmlWith(smuggled)]), compileCtx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain('render_forbidden_content');
  });
});
