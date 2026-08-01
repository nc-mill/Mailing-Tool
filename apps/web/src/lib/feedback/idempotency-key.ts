/**
 * Jméno skrytého pole s klíčem idempotence.
 *
 * ODCHYLKA OD PLÁNU, vynucená hranicí server/klient: plán importoval konstantu
 * ze souboru `idempotency-field.tsx`, jenže ten je označený `'use client'`.
 * Server Action, která by z něj konstantu vzala, by nedostala řetězec, ale
 * klientskou referenci, protože bundler App Routeru nahradí VŠECHNY exporty
 * klientského modulu proxy objekty. Konstanta proto bydlí v obyčejném modulu,
 * který smí číst server i klient, a `idempotency-field.tsx` ji jen přeposílá.
 */
export const IDEMPOTENCY_FIELD_NAME = '_idempotency_key';
