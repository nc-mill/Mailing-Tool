import { suppressedExistsSql } from '../../contacts/suppression/predicate';
import type { Operator } from '../ast';
import type { ParamBag } from './params';
import { assertAlias } from './columns';

/**
 * Uvozovky kolem stavů (`'confirmed'`, `'granted'`) jsou v pořádku: nejsou to
 * hodnoty od uživatele, jsou to konstanty z kódu, které si nemůže nikdo zvenčí
 * zvolit. Sada invariantů kontroluje, že všechny OSTATNÍ hodnoty jsou parametry.
 *
 * Všechny predikáty v tomhle souboru stojí na `EXISTS`, takže jsou totální:
 * vracejí `true` nebo `false`, nikdy neznámo. Negace je proto bezpečná
 * i bez obalu, `NOT EXISTS` je pořád dvouhodnotové.
 */
export function compileTagCondition(
  alias: string,
  operator: Operator,
  values: string[],
  bag: ParamBag,
): string {
  assertAlias(alias);
  const ids = bag.add(values, 'uuid[]');
  const exists = `EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = ${alias}.id AND ct.workspace_id = ${alias}.workspace_id AND ct.tag_id = ANY(${ids}))`;
  switch (operator) {
    case 'has_any':
      return `(${exists})`;
    case 'has_none':
      return `(NOT ${exists})`;
    case 'has_all':
      return `((SELECT count(*) FROM contact_tags ct WHERE ct.contact_id = ${alias}.id AND ct.workspace_id = ${alias}.workspace_id AND ct.tag_id = ANY(${ids})) = cardinality(${ids}))`;
    default:
      throw new Error(`operator ${operator} is not valid for tags`);
  }
}

export function compileListCondition(
  alias: string,
  listId: string,
  operator: Operator,
  bag: ParamBag,
): string {
  assertAlias(alias);
  const id = bag.add(listId, 'uuid');
  const asOf = bag.ref(2, 'timestamptz');
  const base = (status: string): string =>
    `EXISTS (SELECT 1 FROM list_subscriptions ls WHERE ls.contact_id = ${alias}.id` +
    ` AND ls.workspace_id = ${alias}.workspace_id AND ls.list_id = ${id} AND ls.status = '${status}'`;
  const notSnoozed = ` AND (ls.snooze_until IS NULL OR ls.snooze_until <= ${asOf}))`;
  switch (operator) {
    // "Je v seznamu" znamená potvrzené přihlášení a nepozastavenou komunikaci.
    // Kdyby to znamenalo jen existenci řádku, dostal by poštu i ten, kdo nepotvrdil.
    case 'is_member':
      return `(${base('confirmed')}${notSnoozed})`;
    case 'is_not_member':
      return `(NOT ${base('confirmed')}${notSnoozed})`;
    case 'is_confirmed':
      return `(${base('confirmed')}${notSnoozed})`;
    case 'is_pending':
      return `(${base('pending')}))`;
    case 'is_unsubscribed':
      return `(${base('unsubscribed')}))`;
    default:
      throw new Error(`operator ${operator} is not valid for lists`);
  }
}

export function compileConsentCondition(
  alias: string,
  purpose: string,
  operator: Operator,
  bag: ParamBag,
): string {
  assertAlias(alias);
  const p = bag.add(purpose);
  const withStatus = (status: string): string =>
    `EXISTS (SELECT 1 FROM contact_consent_state s WHERE s.contact_id = ${alias}.id` +
    ` AND s.workspace_id = ${alias}.workspace_id AND s.purpose = ${p} AND s.status = '${status}')`;
  switch (operator) {
    case 'is_granted':
      return `(${withStatus('granted')})`;
    case 'is_withdrawn':
      return `(${withStatus('withdrawn')})`;
    // "Nikdy nedal" je nepřítomnost záznamu, ne stav withdrawn. Právně to nejsou totéž.
    case 'is_missing':
      return `(NOT EXISTS (SELECT 1 FROM contact_consent_state s WHERE s.contact_id = ${alias}.id AND s.workspace_id = ${alias}.workspace_id AND s.purpose = ${p}))`;
    default:
      throw new Error(`operator ${operator} is not valid for consents`);
  }
}

export function compileSuppressionCondition(alias: string, operator: Operator): string {
  assertAlias(alias);
  // Predikát se tu neopisuje, viz contacts/suppression/predicate.ts.
  const exists = suppressedExistsSql(alias);
  switch (operator) {
    case 'is_suppressed':
      return `(${exists})`;
    case 'is_not_suppressed':
      return `(NOT ${exists})`;
    default:
      throw new Error(`operator ${operator} is not valid for suppression`);
  }
}
