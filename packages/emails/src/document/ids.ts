import { customAlphabet } from 'nanoid';

/**
 * Identita bloku podle 3.1.3. Jednoznačná v rámci dokumentu, ne globálně.
 * Poznámka k rozsahu: 36^12 je zhruba 2^62, ne 2^72, jak uvádí text specifikace.
 * Formát je normativní (regulární výraz níž je i v JSON Schema), takže ho neměníme;
 * 62 bitů na jednoznačnost uvnitř dokumentu o nejvýše 300 blocích bohatě stačí.
 */
export const BLOCK_ID_PATTERN = /^b_[0-9a-z]{12}$/;

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

export function newBlockId(): string {
  return `b_${nano()}`;
}

export function isBlockId(value: unknown): value is string {
  return typeof value === 'string' && BLOCK_ID_PATTERN.test(value);
}
