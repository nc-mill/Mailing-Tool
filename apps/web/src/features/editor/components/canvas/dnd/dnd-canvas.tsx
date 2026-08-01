'use client';

import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { EDITOR_DND_ENABLED } from '../../../config';
import type { MoveTarget } from '../../../model/ops';
import type { Path } from '../../../model/tree';

export type DndItem = { id: string; path: Path };

/** Spočítá cíl upuštění z cesty vlečeného a cílového bloku. Čistá funkce, testuje se bez DOM. */
export function dropTargetFor(
  items: DndItem[],
  activeId: string,
  overId: string,
): MoveTarget | null {
  if (activeId === overId) return null;
  const over = items.find((item) => item.id === overId);
  if (!over) return null;
  return { parent: over.path.slice(0, -1), index: over.path[over.path.length - 1] ?? 0 };
}

export function DndCanvas(props: {
  items: DndItem[];
  onMove: (id: string, target: MoveTarget) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  if (!EDITOR_DND_ENABLED) return <>{props.children}</>;
  return (
    <DndContext
      sensors={sensors}
      // Plán psal `announcements: undefined`, jenže `exactOptionalPropertyTypes`
      // takový zápis odmítá: nepovinná vlastnost se vynechává, nenastavuje na
      // undefined. Účel zůstává, oznámení si editor vyrábí sám v `run-operation.ts`.
      accessibility={{}}
      onDragEnd={(event) => {
        const overId = event.over?.id;
        if (!overId) return;
        const target = dropTargetFor(props.items, String(event.active.id), String(overId));
        if (target) props.onMove(String(event.active.id), target);
      }}
    >
      <div data-testid="dnd-context">{props.children}</div>
    </DndContext>
  );
}
