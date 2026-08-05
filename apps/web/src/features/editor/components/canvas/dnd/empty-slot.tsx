'use client';

import { useDroppable } from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import type { Path } from '../../../model/tree';
import { InsertMenu } from '../insert-menu';
import { useDragPayload } from './dnd-canvas';

/**
 * Prázdný sloupec (a prázdná sekce): plocha, která říká, že sem něco patří.
 *
 * Bez ní byl sloupec po vložení rozvržení „Dva sloupce" prostě prázdné místo.
 * Uživatel do něj neměl jak nic dostat: paleta vkládala za vybraný blok,
 * přetahování mířilo jen mezi sourozence nejvyšší úrovně a na plátně nebylo
 * nic, na co by šlo kliknout. Rozvržení do sloupců tím byla mrtvá položka.
 *
 * Cesty jsou dvě, jak má být: tlačítko „+" (funguje i z klávesnice a na dotyku)
 * a upuštění přetaženého bloku (rychlé pro myš).
 */
export function EmptySlot({
  parent,
  accepts,
  label,
}: {
  parent: Path;
  accepts: boolean;
  /** Popisek plochy, například „Prázdný sloupec". */
  label: string;
}) {
  const t = useTranslations('editor');
  const payload = useDragPayload();
  const dragging = payload !== null;
  const { setNodeRef, isOver } = useDroppable({
    id: `empty:${parent.join('.')}`,
    data: { parent, index: 0 },
    disabled: !dragging || !accepts,
  });

  const highlight = dragging && accepts;

  return (
    <div
      ref={setNodeRef}
      data-testid={`empty-slot-${parent.join('.')}`}
      data-over={isOver ? 'true' : undefined}
      style={{
        minHeight: '72px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        borderRadius: '6px',
        border: `2px dashed ${
          isOver
            ? 'var(--color-primary)'
            : highlight
              ? 'var(--color-border-strong)'
              : 'var(--color-border)'
        }`,
        backgroundColor: isOver ? 'var(--color-accent-surface)' : 'transparent',
        color: 'var(--color-text-muted)',
        fontSize: '12px',
      }}
    >
      <span>{label}</span>
      {/* Nabídka nabízí jen to, co gramatika na tomhle místě dovolí, takže
          se do sloupce nedá vložit sekce ani další sloupce. */}
      <InsertMenu
        parent={parent}
        index={0}
        label={t('insert.intoEmpty')}
        testId={`insert-into-${parent.join('.')}`}
      />
    </div>
  );
}
