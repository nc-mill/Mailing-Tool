/**
 * Operátory, po kterých kontakt s NEVYPLNĚNÝM polem do segmentu nespadne.
 *
 * Vlastní modul, ne součást `null-hint.tsx`: ten je klientská komponenta
 * (`'use client'`), takže cokoli z něj jde ze serveru zavolat jen jako akci.
 * Katalog polí se skládá na serveru a potřebuje jen tenhle seznam. Ověřeno
 * spuštěním: import z klientského modulu shodil vykreslení stránky na
 * „Attempted to call isNegating() from the server but it is on the client".
 */
export const NEGATING_OPERATORS = [
  'neq',
  'not_contains',
  'not_in',
  'has_none',
  'not_in_last_days',
] as const;

export function isNegating(operator: string): boolean {
  return (NEGATING_OPERATORS as readonly string[]).includes(operator);
}
