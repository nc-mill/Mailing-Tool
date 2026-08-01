'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';

/**
 * Tenká vrstva nad `@dnd-kit`. Typy knihovny odsud ven neunikají (část 6, 13.2),
 * takže výměna za nativní přetahování je změna dvou souborů.
 *
 * Úchyt je jediné místo, které na tažení reaguje, a má `aria-hidden`: klávesová
 * cesta vede jinudy a je na knihovně nezávislá (rozhodnutí R5).
 */
export function SortableBlock({
  id,
  children,
}: {
  id: string;
  children: (dragHandle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id });

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
    <div
      ref={setNodeRef}
      role="none"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="relative"
    >
      {children(handle)}
    </div>
  );
}
