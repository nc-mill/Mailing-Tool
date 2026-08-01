import type { ReactElement } from 'react';
import { useEmitter } from './ctx';

/**
 * Vypustí do stromu textový žeton, který kompilace po renderu nahradí syrovým HTML.
 * Nepoužívá se React atribut pro vkládání HTML, protože ten vždy potřebuje
 * obalový element, a `<span>` mezi `<table>` a `<tr>` rozbije strukturu v Outlooku.
 */
export function Raw({ html }: { html: string }): ReactElement {
  const { raw } = useEmitter();
  return <>{raw.add(html)}</>;
}

/** Varianta pro místa, kde je potřeba jen řetězec, například jako children. */
export function useRaw(): (html: string) => string {
  const { raw } = useEmitter();
  return (html: string) => raw.add(html);
}
