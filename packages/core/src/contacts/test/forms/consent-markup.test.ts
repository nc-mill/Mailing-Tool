import { describe, expect, it } from 'vitest';
import { consentTextToHtml, parseConsentText } from '../../forms/consent-markup';

/**
 * Text souhlasu je jediné místo produktu, kde člověk zapisuje obsah vykreslovaný
 * na VEŘEJNÉ stránce cizího webu. Půlka testů proto míří na to, co se vykreslit
 * NESMÍ; ta je důležitější, protože chybějící odkaz je vidět hned, kdežto propuštěná
 * značka se pozná až tehdy, když ji někdo zneužije.
 */
describe('odkaz v textu souhlasu', () => {
  it('rozpozná zápis se značkou, protože ten člověk zkusí nejdřív', () => {
    expect(
      parseConsentText('Souhlasím s <a href="https://example.cz/podminky">podmínkami</a>.'),
    ).toEqual([
      { kind: 'text', value: 'Souhlasím s ' },
      { kind: 'link', href: 'https://example.cz/podminky', text: 'podmínkami' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('rozpozná i kratší zápis v hranatých závorkách', () => {
    expect(parseConsentText('Beru na vědomí [zásady](https://example.cz/gdpr).')).toEqual([
      { kind: 'text', value: 'Beru na vědomí ' },
      { kind: 'link', href: 'https://example.cz/gdpr', text: 'zásady' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('zvládne dva odkazy v jedné větě', () => {
    const out = parseConsentText(
      'Souhlasím s [podmínkami](https://a.cz) a se [zpracováním](https://b.cz).',
    );
    expect(out.filter((s) => s.kind === 'link')).toHaveLength(2);
  });

  it('text bez odkazu zůstane jedním kusem textu', () => {
    expect(parseConsentText('Souhlasím se zpracováním údajů.')).toEqual([
      { kind: 'text', value: 'Souhlasím se zpracováním údajů.' },
    ]);
  });

  /**
   * `javascript:` je klasický způsob, jak z odkazu udělat spouštěč kódu. Kontrola
   * stojí na rozboru adresy, ne na hledání podřetězce, takže ji neobejde ani jiná
   * velikost písmen, ani bílý znak uvnitř schématu.
   */
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '/relativni/cesta',
  ])('nepovolenou adresu %s NEUDĚLÁ odkazem', (href) => {
    const out = parseConsentText(`Klikni [sem](${href}) prosím`);
    expect(out.some((s) => s.kind === 'link')).toBe(false);
    // A hlavně nezmizí: souhlas je právní doklad, takže se ukáže tak, jak byl zapsán.
    expect(out.map((s) => (s.kind === 'text' ? s.value : '')).join('')).toContain('sem');
  });

  it('nepovolenou adresu neudělá odkazem ani ve značkovém zápisu', () => {
    const out = parseConsentText('Klikni <a href="javascript:alert(1)">sem</a>.');
    expect(out.some((s) => s.kind === 'link')).toBe(false);
  });

  it('jiné značky než odkaz zůstanou TEXTEM, nevykreslí se', () => {
    const out = parseConsentText('Souhlas <script>alert(1)</script> a <b>tučně</b>');
    expect(out.every((s) => s.kind === 'text')).toBe(true);
  });

  describe('vykreslení do HTML řetězce', () => {
    it('escapuje značky, které nejsou odkaz', () => {
      const html = consentTextToHtml('<script>alert(1)</script>');
      expect(html).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<script');
    });

    it('odkaz otevírá v novém okně a bez předání odkazující stránky', () => {
      const html = consentTextToHtml('[podmínky](https://example.cz/p)');
      expect(html).toBe(
        '<a href="https://example.cz/p" target="_blank" rel="noopener noreferrer nofollow">podmínky</a>',
      );
    });

    it('escapuje uvozovky v popisku, aby se nedal atribut předčasně uzavřít', () => {
      expect(consentTextToHtml('[a" onmouseover="alert(1)](https://e.cz)')).not.toContain(
        'onmouseover="alert',
      );
    });
  });
});
