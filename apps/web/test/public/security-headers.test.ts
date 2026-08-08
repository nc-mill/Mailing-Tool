// @vitest-environment node
/**
 * Bezpečnostní hlavičky veřejných stránek, zkoumané na samotném pomocníkovi.
 *
 * Testy tady schválně nesahají do databáze: politika obsahu je čistá funkce
 * a musí zčervenat i ve chvíli, kdy je databázová série vypnutá.
 * Chování skutečných tras je v `public-pages.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { publicHtmlResponse } from '../../src/features/public/render';
import {
  buildAppCsp,
  buildPublicCsp,
  publicSecurityHeaders,
} from '../../src/features/public/security-headers';

describe('politika obsahu veřejné stránky', () => {
  it('je přísnější než v aplikaci: žádný skript a nulový základ', () => {
    const csp = buildPublicCsp('sealed');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    // Aplikace skripty potřebuje, veřejná stránka ne. Kdyby se sady spojily,
    // veřejná stránka by tiše zlevnila na politiku aplikace.
    expect(buildAppCsp('nonce123')).toContain("script-src 'self'");
  });

  it('pouští vložený styl, jinak by navrženou stránku zabila', () => {
    // Obal veřejné stránky nese CSS ve značce `<style>` a dokument z Builderu
    // má styly přímo v atributech. Bez `unsafe-inline` by se stránka rozsypala
    // až u návštěvníka, tedy tam, kde to nikdo z nás neuvidí.
    expect(buildPublicCsp('sealed')).toContain("style-src 'unsafe-inline'");
    expect(buildPublicCsp('sealed')).toContain("img-src 'self' data: https:");
  });

  it('zapečetěný povrch zakazuje rámování dvakrát, kvůli starším prohlížečům', () => {
    const headers = publicSecurityHeaders('sealed');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('vkládaný povrch rámování NEZAKAZUJE ani jednou', () => {
    const headers = publicSecurityHeaders('embeddable');
    expect(headers['content-security-policy']).not.toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain('frame-ancestors *');
    // Hodnota „rámovat smí kdokoliv" v téhle hlavičce neexistuje, takže se
    // nesmí objevit vůbec. Jinak zákaz přebije politiku obsahu.
    expect(headers['x-frame-options']).toBeUndefined();
  });

  /**
   * Referer je jediná hlavička, kterou tu nejde utáhnout na doraz. `no-referrer`
   * podle Fetch specifikace pošle u odeslání formuláře mimo CORS `Origin: null`
   * a první vrstva ochrany formulářů (`allowedOrigins`) by legitimní odeslání
   * odmítla jako cizí původ. `strict-origin-when-cross-origin` cizí doméně
   * stejně nedá cestu, tedy ani token.
   */
  it('politika odkazující stránky nesmí zahodit původ, jinak padne ochrana formulářů', () => {
    expect(publicSecurityHeaders('sealed')['referrer-policy']).toBe(
      'strict-origin-when-cross-origin',
    );
  });
});

describe('publicHtmlResponse', () => {
  it('nese bezpečnostní hlavičky i dnešní zákaz cache a indexace', () => {
    const response = publicHtmlResponse('<!doctype html><html></html>');
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('content-security-policy') ?? '').toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('vkládaná varianta se dál smí zobrazit v cizím rámu', () => {
    const response = publicHtmlResponse('<!doctype html><html></html>', { embeddable: true });
    expect(response.headers.get('x-frame-options')).toBeNull();
    // Kladné tvrzení, ne jen „neobsahuje zákaz": odpověď úplně bez politiky
    // obsahu se taky nedá zarámovat zakázat, a to je přesně ta vada, kterou
    // tenhle oddíl opravuje.
    expect(response.headers.get('content-security-policy') ?? '').toContain('frame-ancestors *');
  });
});
