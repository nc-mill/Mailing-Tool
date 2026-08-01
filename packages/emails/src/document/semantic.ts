import type { Issue } from '../issue';
import type { Document } from './types';
import { checkFields, type FieldContext } from './semantic-fields';
import { checkStructure } from './semantic-structure';

export type SemanticContext = FieldContext;

/**
 * Sémantická vrstva nad JSON Schema. Pořadí je pevné: nejdřív struktura,
 * pak pole a Liquid, aby hlášky v editoru chodily vždy ve stejném pořadí
 * a snapshot testy se nerozjížděly.
 */
export function checkSemantics(doc: Document, ctx: SemanticContext): Issue[] {
  return [...checkStructure(doc, { templateKind: ctx.templateKind }), ...checkFields(doc, ctx)];
}

// `hasBlockingIssue` bydlí u typu, tedy v `../issue`. Reexportuje se sem,
// aby doménová vrstva měla jednu adresu, ale definice je jen jedna.
export { hasBlockingIssue } from '../issue';
