/**
 * Typy pro `psl` 1.15.0.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ BALÍČKEM A OVĚŘENÁ PŘEKLADEM. Plán počítal s tím, že
 * `import psl from 'psl'` prostě funguje. Nefunguje, a to ze dvou spolupůsobících důvodů:
 *
 * 1. `psl` deklarace SVÉ TYPY VOZÍ (`types/index.d.ts`), ale jeho mapa `exports` má jen
 *    podmínky `import` a `require`, žádnou `types`. Při `moduleResolution: Bundler`,
 *    které repozitář používá, se proto k souboru nedá dostat a překlad končí TS7016.
 * 2. `@types/psl` je od vydání 1.11.0 jen ZÁSTUPNÝ balíček bez jediné deklarace, který
 *    říká „psl si typy vozí sám". Nainstalovat ho tedy nic neřeší.
 *
 * Deklarace níž popisuje jen to, co tenhle plán volá, a odpovídá skutečnému chování
 * ověřenému spuštěním nad Node 24: `parse('co.uk')` vrací `domain: null`,
 * `parse('mail.example.cz')` vrací `domain: 'example.cz'`, výchozí export je objekt
 * se třemi funkcemi.
 */
declare module 'psl' {
  export type ParsedDomain = {
    input: string;
    tld: string | null;
    sld: string | null;
    domain: string | null;
    subdomain: string | null;
    listed: boolean;
  };

  export type ErrorResult = {
    input: string;
    error: { code: string; message: string };
  };

  export function parse(input: string): ParsedDomain | ErrorResult;
  export function get(domain: string): string | null;
  export function isValid(domain: string): boolean;

  const psl: {
    parse: typeof parse;
    get: typeof get;
    isValid: typeof isValid;
  };
  export default psl;
}
