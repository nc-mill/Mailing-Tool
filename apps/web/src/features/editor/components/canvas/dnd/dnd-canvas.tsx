'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
} from '@dnd-kit/core';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { EDITOR_DND_ENABLED } from '../../../config';
import type { MoveTarget } from '../../../model/ops';
import type { Path } from '../../../model/tree';

/**
 * Co se právě táhne.
 *
 * Dvě věci, ne jedna: nový blok z palety a už vložený blok z plátna. Dřív uměl
 * editor jen druhé z toho, a to ještě nad PLOCHÝM seznamem sourozenců, takže
 * blok nešlo upustit dovnitř sloupce. Palety se přetahování netýkalo vůbec:
 * blok z ní přistál za vybraným blokem nebo na konci dokumentu.
 */
export type DragPayload =
  | { kind: 'new'; blockType: string; preset: Record<string, unknown>; label: string }
  | { kind: 'move'; id: string; blockType: string; label: string };

/** Místo upuštění: seznam potomků daného bloku a pozice v něm. */
export type DropPlace = { parent: Path; index: number };

/**
 * Rozhoduje ŠPIČKA KURZORU, ne obdélník vlečeného štítku.
 *
 * Výchozí `rectIntersection` porovnává plochy: štítek pod kurzorem je velký,
 * překrývá i sousední cíle a vyhraje ten s větším průnikem. V praxi to znamenalo,
 * že blok upuštěný doprostřed prázdného sloupce spadl VEDLE sloupců, do sekce,
 * protože se štítek dotkl i čáry pod rozvržením. Ověřeno klikáním, ne odhadem.
 *
 * `pointerWithin` vrací jen cíle, uvnitř kterých kurzor opravdu je, seřazené
 * podle vzdálenosti od středu. `rectIntersection` zůstává jako záloha pro
 * situaci, kdy kurzor není v žádném cíli (například tažení mimo okno).
 */
const collisionDetection: CollisionDetection = (args) => {
  const under = pointerWithin(args);
  return under.length > 0 ? under : rectIntersection(args);
};

const DragContext = createContext<DragPayload | null>(null);

/** Co se táhne, nebo `null`. Čtou to místa upuštění, aby se kreslila jen při tažení. */
export function useDragPayload(): DragPayload | null {
  return useContext(DragContext);
}

export function DndCanvas(props: {
  /** Smí tenhle náklad do tohohle rodiče? Gramatiku dodává plátno z modelu. */
  accepts: (payload: DragPayload, parent: Path) => boolean;
  onInsert: (payload: Extract<DragPayload, { kind: 'new' }>, place: DropPlace) => void;
  onMove: (id: string, target: MoveTarget) => void;
  children: ReactNode;
}) {
  // Vzdálenost 6 px je nutná, aby tažení nesnědlo obyčejný klik: paleta i bloky
  // se pořád dají ovládat kliknutím a to je jediná cesta pro dotyk a klávesnici.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [payload, setPayload] = useState<DragPayload | null>(null);

  if (!EDITOR_DND_ENABLED) return <>{props.children}</>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // Plán psal `announcements: undefined`, jenže `exactOptionalPropertyTypes`
      // takový zápis odmítá: nepovinná vlastnost se vynechává, nenastavuje na
      // undefined. Účel zůstává, oznámení si editor vyrábí sám v `run-operation.ts`.
      accessibility={{}}
      onDragStart={(event) => {
        setPayload((event.active.data.current ?? null) as DragPayload | null);
      }}
      onDragCancel={() => setPayload(null)}
      onDragEnd={(event) => {
        setPayload(null);
        const place = event.over?.data.current as DropPlace | undefined;
        const active = event.active.data.current as DragPayload | undefined;
        if (!place || !active) return;
        if (!props.accepts(active, place.parent)) return;
        if (active.kind === 'new') props.onInsert(active, place);
        else props.onMove(active.id, { parent: place.parent, index: place.index });
      }}
    >
      <DragContext.Provider value={payload}>
        <div data-testid="dnd-context">{props.children}</div>
        {/* Duch pod kurzorem. Bez něj uživatel při tažení z palety nevidí, co
            vlastně veze, protože tlačítko v paletě zůstává na místě. */}
        <DragOverlay dropAnimation={null}>
          {payload ? (
            <span className="rounded-[var(--radius-control)] border border-border bg-surface-overlay px-2 py-1 text-meta shadow-[var(--shadow-flyout)]">
              {payload.label}
            </span>
          ) : null}
        </DragOverlay>
      </DragContext.Provider>
    </DndContext>
  );
}
