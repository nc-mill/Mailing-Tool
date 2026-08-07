import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { Document, InlineNode } from '../../src/document/types';
import { renderPageHtml } from '../../src/emitter/render-page';
import { compileDocument } from '../../src/compile/compile';
import type { CompileContext } from '../../src/compile/types';
import type { TemplateKind } from '../../src/document/profile';

/** Nejmenší kontext kompilace. Zajímá nás JEN volba obalu, ne odkazy ani majetky. */
const compileCtx = (kind: TemplateKind, over: Partial<CompileContext> = {}): CompileContext => ({
  workspaceId: '019fc763-7184-72dd-a48d-3cf3ec306179',
  templateKind: kind,
  fields: { core: [], attributes: [] } as unknown as CompileContext['fields'],
  language: 'cs',
  assetBaseUrl: 'https://priklad.cz',
  assets: {},
  purpose: 'preview',
  trackOpens: false,
  trackClicks: false,
  currentYear: 2026,
  ...over,
});

const doc = (children: InlineNode[]): Document =>
  ({
    schemaVersion: 1,
    meta: { name: 'Děkujeme za přihlášení', previewText: 'Skrytý text e-mailu', language: 'cs' },
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
            props: { ...blockDefaults('text'), content: [{ t: 'p', children }] },
          },
        ],
      },
    ],
  }) as Document;

const plain = doc([{ t: 's', v: 'Hotovo, přihlášení je potvrzené.' }]);

const run = (input: Document = plain, over: Record<string, unknown> = {}) =>
  renderPageHtml({ document: input, rawNonce: 'ab12cd34ef', ...over });

describe('renderPageHtml a PageShell', () => {
  it('nevykreslí preheader', async () => {
    const html = await run();
    // Text náhledu je e-mailový pojem: schránka ho ukáže v seznamu zpráv.
    // Na stránce žádný seznam zpráv není, takže by to byl jen skrytý odstavec.
    expect(html).not.toContain('Skrytý text e-mailu');
    expect(html).not.toContain('mso-hide:all');
  });

  it('nevykreslí meta pro tmavý režim poštovních klientů', async () => {
    const html = await run();
    expect(html).not.toContain('<meta name="color-scheme"');
    expect(html).not.toContain('<meta name="supported-color-schemes"');
  });

  it('nevykreslí ani jinou e-mailovou veteš, kterou prohlížeč nepotřebuje', async () => {
    const html = await run();
    expect(html).not.toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(html).not.toContain('<o:PixelsPerInch>');
    expect(html).not.toContain('ML_OPEN_PIXEL');
  });

  it('neodkazuje na žádný externí soubor', async () => {
    const html = await run();
    // Přísná politika obsahu na veřejných stránkách by externí soubor
    // zablokovala a stránka by se rozsypala až u návštěvníka, ne u nás.
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).toContain('<style>');
  });

  it('vycentruje obsah do kontejneru s maximální šířkou z motivu', async () => {
    const html = await run();
    expect(html).toContain('<main');
    expect(html).toContain(`max-width:${DEFAULT_THEME.contentWidth}px`);
    expect(html).toContain('margin:0 auto');
  });

  it('bere pozadí a jazyk z dokumentu, stejně jako e-mail', async () => {
    const html = await run();
    expect(html).toContain('lang="cs"');
    expect(html).toContain('class="ml-body ml-canvas"');
    expect(html).toContain('<title>Děkujeme za přihlášení</title>');
  });

  it('dosadí hodnoty proměnných, když je volající předá', async () => {
    const html = await run(doc([{ t: 'var', expr: 'contact.greeting' }]), {
      data: { contact: { greeting: 'Dobrý den, Jano' } },
    });
    expect(html).toContain('Dobrý den, Jano');
    expect(html).not.toContain('{{');
  });

  it('dosadí náhradní hodnotu, takže po žetonu argumentu nezbude stopa', async () => {
    const html = await run(
      doc([{ t: 'var', expr: 'contact.greeting | default', fallback: 'Dobrý den' }]),
      { data: { contact: {} } },
    );
    expect(html).toContain('Dobrý den');
    expect(html).not.toContain('ML_ARG_');
  });

  it('bez dat nechá výrazy nedosazené, ale žetony argumentů dosadí', async () => {
    const html = await run(
      doc([{ t: 'var', expr: 'contact.greeting | default', fallback: 'Dobrý den' }]),
    );
    expect(html).toContain('{{ contact.greeting | default:"Dobrý den" }}');
    expect(html).not.toContain('ML_ARG_');
  });

  it('je bajtově stejný při dvou bězích nad týmž vstupem', async () => {
    expect(await run()).toBe(await run());
  });
});

/**
 * SPOJ MEZI PROFILEM A OBALEM.
 *
 * `PageShell` má vlastní testy výš a `compileDocument` má vlastní jinde, ale
 * mezi nimi nebylo NIC: nikdo neověřoval, že kompilace šablony druhu `page`
 * ten obal opravdu vybere. Přesně v té mezeře 7. 8. 2026 vznikl chybný závěr,
 * že náhled stránky v editoru kreslí e-mailovým emitorem a je potřeba ho
 * přepsat. Nebyla to pravda, ale bez testu to nešlo rozhodnout jinak než
 * čtením tří souborů za sebou.
 *
 * Obal se volí podle PROFILU, ne podle volby volajícího. Kdyby si ho volající
 * směl vybrat, dala by se stránka zkompilovat do e-mailového obalu a naopak.
 */
describe('kompilace vybírá obal podle profilu', () => {
  it('profil page dá stránku, tedy bez preheaderu a bez e-mailové obálky', async () => {
    const result = await compileDocument(plain, compileCtx('page'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toContain('Skrytý text e-mailu');
    expect(result.html).not.toContain('mso-hide:all');
  });

  it('profil campaign dá dál e-mail, aby se zúžení netýkalo rozesílek', async () => {
    const result = await compileDocument(plain, compileCtx('campaign'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Preheader je e-mailový pojem a v e-mailu zůstat MÁ.
    expect(result.html).toContain('Skrytý text e-mailu');
  });

  it('stránka se nesleduje, pixel otevření do ní nepatří', async () => {
    const result = await compileDocument(plain, compileCtx('page', { trackOpens: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Za stránkou nestojí kampaň, které by se otevření připsalo, takže by to
    // byla značka, kterou nikdo nezpracuje.
    expect(result.html).not.toContain('/t/o/');
  });
});
