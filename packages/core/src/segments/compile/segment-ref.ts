import type { Operator } from '../ast';
import type { ParamBag } from './params';
import { assertAlias } from './columns';

let aliasCounter = 0;

/** Alias vnořeného segmentu musí být jedinečný, jinak si dva odkazy přepíšou rozsah. */
export function nextChildAlias(): string {
  aliasCounter = (aliasCounter + 1) % 1000;
  return `s${aliasCounter}`;
}

export function resetChildAlias(): void {
  aliasCounter = 0;
}

/**
 * Vnořený dynamický segment nese vlastní tři podmínky obálky (projekt, měkké
 * smazání, omezené zpracování), ale NE větev suppression: ta je v hlavní obálce
 * a druhý výskyt by jen zdvojil práci bez efektu, protože obě mluví o témž kontaktu.
 *
 * Oba tvary stojí na `EXISTS`, takže jsou totální a `not_in` je bezpečná negace.
 */
export function compileSegmentRefCondition(
  alias: string,
  segmentId: string,
  operator: Operator,
  target: { kind: 'static' | 'dynamic' },
  bag: ParamBag,
  compileChild: (childAlias: string) => string,
): string {
  assertAlias(alias);
  let inner: string;
  if (target.kind === 'static') {
    const id = bag.add(segmentId, 'uuid');
    inner = `EXISTS (SELECT 1 FROM segment_members sm WHERE sm.segment_id = ${id} AND sm.workspace_id = ${alias}.workspace_id AND sm.contact_id = ${alias}.id)`;
  } else {
    const child = nextChildAlias();
    const childSql = compileChild(child);
    inner =
      `EXISTS (SELECT 1 FROM contacts ${child} WHERE ${child}.id = ${alias}.id ` +
      `AND ${child}.workspace_id = ${bag.ref(1)} AND ${child}.deleted_at IS NULL ` +
      `AND ${child}.processing_restricted = false AND (${childSql}))`;
  }
  if (operator === 'in') return `(${inner})`;
  if (operator === 'not_in') return `(NOT ${inner})`;
  throw new Error(`operator ${operator} is not valid for a segment reference`);
}
