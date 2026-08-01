'use client';

import { useState } from 'react';

import { IDEMPOTENCY_FIELD_NAME } from './idempotency-key';

export { IDEMPOTENCY_FIELD_NAME };

/**
 * Klíč vzniká jednou při vykreslení formuláře, ne při každém odeslání. Díky
 * tomu je dvojklik na tlačítko dvakrát tentýž požadavek, tedy přesně případ,
 * na který je idempotence z 4.4 části 1. Nové odeslání po chybě používá stejný
 * klíč, dokud se stránka nepřenačte, což je správně: opakování stejného
 * špatného požadavku má dát stejnou odpověď.
 */
export function IdempotencyField() {
  const [key] = useState(() => crypto.randomUUID());
  return <input type="hidden" name={IDEMPOTENCY_FIELD_NAME} value={key} readOnly />;
}
