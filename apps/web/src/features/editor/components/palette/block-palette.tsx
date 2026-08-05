'use client';

import { useDraggable } from '@dnd-kit/core';
import { Button } from '@mlain/ui/components/button';
import { useTranslations } from 'next-intl';
import { EDITOR_DND_ENABLED } from '../../config';
import { PALETTE } from '../../descriptors/registry';
import type { MoveTarget } from '../../model/ops';
import { canContain, findBlock, typeAt } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';

/**
 * Paleta bloků.
 *
 * DVĚ CESTY, ne jedna. Kliknutí vloží blok za vybraný blok (a je to jediná
 * cesta pro klávesnici a dotyk), přetažení ho položí přesně tam, kam uživatel
 * ukáže, tedy i dovnitř sloupce. Dřív existovalo jen kliknutí, takže blok
 * padal na konec dokumentu nebo k označenému bloku a rozvržení do sloupců
 * se nedala naplnit vůbec.
 *
 * Přetažení se spouští až po 6 px pohybu (`PointerSensor` v `DndCanvas`),
 * takže obyčejný klik zůstává klikem.
 */
export function BlockPalette() {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const selectedId = useEditorState((state) => state.selectedId);

  const targetFor = (type: string): MoveTarget | null => {
    const found = selectedId ? findBlock(document, selectedId) : undefined;
    if (found) {
      const parent = found.path.slice(0, -1);
      if (canContain(typeAt(document, parent), type)) {
        return { parent, index: (found.path[found.path.length - 1] ?? 0) + 1 };
      }
      if (canContain(found.block.type, type)) {
        return { parent: found.path, index: (found.block.children ?? []).length };
      }
    }
    if (type === 'section') return { parent: [], index: document.blocks.length };
    const last = document.blocks.length - 1;
    const lastBlock = document.blocks[last];
    return lastBlock ? { parent: [last], index: (lastBlock.children ?? []).length } : null;
  };

  return (
    <aside
      aria-label={t('palette.title')}
      className="w-48 shrink-0 space-y-3 overflow-auto border-r border-border p-3"
    >
      <h2 className="text-sm font-semibold">{t('palette.title')}</h2>
      {PALETTE.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="text-xs uppercase text-text-muted">{t(group.label)}</p>
          {group.entries.map((entry) => (
            <PaletteEntry
              key={entry.id}
              id={entry.id}
              type={entry.type}
              label={t(entry.label)}
              preset={entry.preset ?? {}}
              onClick={() => {
                const target = targetFor(entry.type);
                if (target) store.insertBlock(entry.type, target, entry.preset ?? {});
              }}
            />
          ))}
        </div>
      ))}
      <p className="text-xs text-text-muted">{t('palette.dragHint')}</p>
    </aside>
  );
}

function PaletteEntry(props: {
  id: string;
  type: string;
  label: string;
  preset: Record<string, unknown>;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${props.id}`,
    data: { kind: 'new', blockType: props.type, preset: props.preset, label: props.label },
    disabled: !EDITOR_DND_ENABLED,
  });

  return (
    <Button
      ref={setNodeRef}
      variant="ghost"
      className="w-full cursor-grab justify-start"
      style={{ opacity: isDragging ? 0.5 : 1 }}
      data-testid={`palette-${props.id}`}
      onClick={props.onClick}
      {...attributes}
      {...listeners}
      // `attributes` z knihovny nesou `role="button"` a `tabIndex`, což tlačítko
      // už má; přepsat je zpátky by rozbilo klávesovou cestu k vložení klikem.
      role={undefined}
    >
      {props.label}
    </Button>
  );
}
