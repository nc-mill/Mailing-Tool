/**
 * ROZHRANÍ, KTERÉ TENHLE BALÍČEK OČEKÁVÁ OD `html-to-text` 10.0.0.
 *
 * Balíček od verze 9 vlastní typy nedodává a `@types/html-to-text` na
 * DefinitelyTyped popisuje starší, nekompatibilní API. Deklaruje se proto jen
 * ta část, kterou textový emitter opravdu volá; kdyby se sáhlo po čemkoli dalším,
 * typecheck to zastaví, místo aby to tiše prošlo jako `any`.
 */
declare module 'html-to-text' {
  export type ConvertSelector = {
    selector: string;
    format?: string;
    options?: Record<string, unknown>;
  };

  export type ConvertOptions = {
    wordwrap?: number | false | null;
    preserveNewlines?: boolean;
    selectors?: ConvertSelector[];
  };

  export function convert(html: string, options?: ConvertOptions): string;
}
