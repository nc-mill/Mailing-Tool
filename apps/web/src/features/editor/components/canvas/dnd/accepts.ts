import type { EditorDocument } from '../../../model/document-types';
import { canContain, findBlock, typeAt, type Path } from '../../../model/tree';
import type { DragPayload } from './dnd-canvas';

/**
 * Smí náklad do seznamu potomků daného bloku?
 *
 * Gramatika se bere z modelu (`canContain`, tabulka ALLOWED v `model/tree.ts`
 * odvozená z typů v `packages/emails/src/document/types.ts`), ne z odhadu:
 * do kořene jen sekce, do sekce obsahové bloky a rozvržení, do sloupce jen
 * obsahové bloky, do sloupců jen sloupce.
 *
 * Druhá podmínka je zdravý rozum: blok nesmí spadnout do sebe ani do svého
 * potomka, jinak by si vlastní podstrom sežral. `moveBlock` by takový přesun
 * odmítl až po upuštění a uživateli by se nestalo nic bez vysvětlení.
 *
 * Čistá funkce: používá ji jak vrstva tažení, tak kreslení míst upuštění, takže
 * se nemůže stát, že se čára nabídne tam, kam blok nepatří.
 */
export function acceptsDrop(document: EditorDocument, payload: DragPayload, parent: Path): boolean {
  if (!canContain(typeAt(document, parent), payload.blockType)) return false;
  if (payload.kind === 'move') {
    const from = findBlock(document, payload.id)?.path;
    if (from && parent.length >= from.length && from.every((step, i) => parent[i] === step)) {
      return false;
    }
  }
  return true;
}
