'use client';

import { useDraggable } from '@dnd-kit/core';
import type { ReactNode } from 'react';

/**
 * Tenká vrstva nad `@dnd-kit`. Typy knihovny odsud ven neunikají (část 6, 13.2),
 * takže výměna za nativní přetahování je změna dvou souborů.
 *
 * Proti dřívějšímu znění to už NENÍ `useSortable` nad plochým seznamem: řazení
 * mezi sourozenci neumělo upustit blok dovnitř sloupce, protože o zanoření
 * nevědělo. Místa upuštění teď kreslí plátno samo (`DropSlot`, `EmptySlot`)
 * na každé úrovni, a odsud stačí říct, co se veze.
 *
 * Úchyt je jediné místo, které na tažení reaguje, a má `aria-hidden`: klávesová
 * cesta vede jinudy a je na knihovně nezávislá (rozhodnutí R5), viz `Alt+↑/↓/←/→`.
 */
export function DraggableBlock({
  id,
  blockType,
  label,
  children,
}: {
  id: string;
  blockType: string;
  label: string;
  children: (dragHandle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id,
    data: { kind: 'move', id, blockType, label },
  });

  const handle = (
    <span
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      // Pořadí je záměrné: `attributes` z knihovny nesou `role="button"`
      // a `tabIndex={0}`, což by z úchytu udělalo druhý tabstop na plátně
      // a shodilo pojistku „jediný tabstop" z úkolu 16.
      role="none"
      aria-hidden
      tabIndex={-1}
      data-testid={`drag-handle-${id}`}
      className="absolute -left-4 top-2 cursor-grab select-none text-text-muted"
    >
      ⠿
    </span>
  );

  return (
    // Vlečený blok zůstává na místě a jen zprůhlední. Posouvat ho pod kurzorem
    // by znamenalo přepočítávat celý e-mail při každém pohybu myši; místo toho
    // veze kurzor lehký štítek (`DragOverlay`) a cíl ukazuje čára.
    <div
      ref={setNodeRef}
      role="none"
      className="relative"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {children(handle)}
    </div>
  );
}
