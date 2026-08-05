'use client';

import { useDroppable } from '@dnd-kit/core';
import type { Path } from '../../../model/tree';
import { useDragPayload } from './dnd-canvas';

/**
 * Místo upuštění mezi dvěma bloky.
 *
 * Kreslí se JEN při tažení a jen tam, kam blok podle gramatiky dokumentu smí
 * (`accepts`). Uživatel tím vidí dopředu, kam blok padne, a zakázaná místa
 * poznává tak, že v nich žádná čára není. Zjišťovat to až po upuštění hláškou
 * je hádání, a přesně to editor dělal.
 *
 * Nezabírá místo v toku: má nulovou výšku a plocha pro trefení je absolutně
 * pozicovaná přes hranu mezi bloky. Kdyby zabírala výšku, poskočil by při
 * začátku tažení celý e-mail a uživatel by mířil na pohyblivý cíl.
 */
export function DropSlot({
  parent,
  index,
  accepts,
}: {
  parent: Path;
  index: number;
  accepts: boolean;
}) {
  const payload = useDragPayload();
  const dragging = payload !== null;
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${parent.join('.')}:${index}`,
    data: { parent, index },
    disabled: !dragging || !accepts,
  });

  if (!dragging || !accepts) return null;

  return (
    <div style={{ position: 'relative', height: 0 }} aria-hidden>
      <div
        ref={setNodeRef}
        data-testid={`drop-slot-${parent.join('.')}-${index}`}
        data-over={isOver ? 'true' : undefined}
        style={{
          position: 'absolute',
          insetInline: 0,
          top: '-7px',
          height: '14px',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            display: 'block',
            width: '100%',
            height: isOver ? '3px' : '1px',
            borderRadius: '2px',
            backgroundColor: isOver ? 'var(--color-primary)' : 'var(--color-border-strong)',
            opacity: isOver ? 1 : 0.5,
          }}
        />
      </div>
    </div>
  );
}
