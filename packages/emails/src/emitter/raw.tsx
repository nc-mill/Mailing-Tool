import type { ReactElement } from 'react';
import type { EmitterProps, EmitterState } from './ctx';

/**
 * Vypustí do stromu textový žeton, který kompilace po renderu nahradí syrovým HTML.
 * Nepoužívá se React atribut pro vkládání HTML, protože ten vždy potřebuje
 * obalový element, a `<span>` mezi `<table>` a `<tr>` rozbije strukturu v Outlooku.
 */
export function Raw({ html, emitter }: { html: string } & EmitterProps): ReactElement {
  return <>{emitter.raw.add(html)}</>;
}

/** Varianta pro místa, kde je potřeba jen řetězec, například jako children. */
export function rawText(emitter: EmitterState, html: string): string {
  return emitter.raw.add(html);
}
