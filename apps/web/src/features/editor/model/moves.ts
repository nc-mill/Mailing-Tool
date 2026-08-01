import type { EditorDocument } from './document-types';
import type { MoveTarget } from './ops';
import { blockAt, canContain, childrenOf, findBlock, type Path, typeAt } from './tree';

/**
 * Převod cílové pozice na místo vložení.
 *
 * `moveDelta`, `moveOut` i `moveIn` popisují, **kde má blok skončit**. `ops.moveBlock`
 * naproti tomu bere místo vložení počítané ještě před odebráním bloku a po odebrání
 * si index sám sníží. U přesunu mezi sourozenci se ta dvě čísla liší přesně o jedna
 * a bez tohohle převodu by se posun dolů vyrušil sám se sebou: blok by se odebral
 * z pozice 0, index 1 by se srovnal zpátky na 0 a dokument by zůstal beze změny.
 * Odchylka od doslovného kódu plánu, jehož dvě sady testů se v téhle konvenci
 * rozcházely; tenhle převod je smiřuje, aniž se kterákoli z nich mění.
 */
export function toInsertionTarget(doc: EditorDocument, id: string, target: MoveTarget): MoveTarget {
  const found = findBlock(doc, id);
  if (!found) return target;
  const parent = found.path.slice(0, -1);
  const index = found.path[found.path.length - 1] ?? 0;
  const sameParent =
    parent.length === target.parent.length &&
    parent.every((value, i) => target.parent[i] === value);
  return sameParent && target.index > index ? { ...target, index: target.index + 1 } : target;
}

/** Posun o jednu pozici mezi sourozenci. Na kraji vrací null, aby volající mohl oznámit mez. */
export function moveDelta(doc: EditorDocument, id: string, delta: -1 | 1): MoveTarget | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  const parent = found.path.slice(0, -1);
  const index = found.path[found.path.length - 1] ?? 0;
  const target = index + delta;
  if (target < 0 || target >= childrenOf(doc, parent).length) return null;
  return { parent, index: target };
}

/** Vysunutí o úroveň výš: najde nejbližšího předka, který blok pobere, a vloží ho hned za jeho potomka. */
export function moveOut(doc: EditorDocument, id: string): MoveTarget | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  for (let cut = found.path.length - 1; cut >= 1; cut -= 1) {
    const parent = found.path.slice(0, cut - 1);
    if (canContain(typeAt(doc, parent), found.block.type)) {
      return { parent, index: (found.path[cut - 1] ?? 0) + 1 };
    }
  }
  return null;
}

function intoContainer(
  doc: EditorDocument,
  containerPath: Path,
  childType: string,
  atEnd: boolean,
): MoveTarget | null {
  const container = blockAt(doc, containerPath);
  if (!container) return null;
  if (canContain(container.type, childType)) {
    const children = container.children ?? [];
    return { parent: containerPath, index: atEnd ? children.length : 0 };
  }
  if (container.type === 'columns') {
    const columns = container.children ?? [];
    if (columns.length === 0) return null;
    const columnIndex = atEnd ? columns.length - 1 : 0;
    const column = columns[columnIndex];
    if (!column || !canContain(column.type, childType)) return null;
    // Směr rozhoduje o tom, DO KTERÉHO sloupce blok jde, ne o pozici uvnitř něj:
    // uvnitř sloupce se vždy zařadí na konec. Odchylka od doslovného kódu plánu,
    // který tady měl `atEnd ? length : 0`; s ním neprojde test „zasune blok do
    // prvního sloupce následujícího sourozence", který v témž plánu čeká index 1.
    // Testy jsou v plánu smlouva, doslovný výraz byl vedle.
    return {
      parent: [...containerPath, columnIndex],
      index: (column.children ?? []).length,
    };
  }
  return null;
}

/** Zasunutí do sousedního kontejneru: nejdřív do předchozího sourozence na konec, jinak do dalšího na začátek. */
export function moveIn(doc: EditorDocument, id: string): MoveTarget | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  const parent = found.path.slice(0, -1);
  const index = found.path[found.path.length - 1] ?? 0;
  const siblings = childrenOf(doc, parent);
  if (index > 0) {
    const target = intoContainer(doc, [...parent, index - 1], found.block.type, true);
    if (target) return target;
  }
  if (index < siblings.length - 1) {
    const target = intoContainer(doc, [...parent, index + 1], found.block.type, false);
    if (target) return target;
  }
  return null;
}
