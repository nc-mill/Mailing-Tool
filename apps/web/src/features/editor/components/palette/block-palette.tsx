'use client';

import { Button } from '@mlain/ui/components/button';
import { useTranslations } from 'next-intl';
import { PALETTE } from '../../descriptors/registry';
import type { MoveTarget } from '../../model/ops';
import { canContain, findBlock, typeAt } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';

/** Paleta vkládá za vybraný blok, případně na konec dokumentu. Blok `repeat` v ní není. */
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
            <Button
              key={entry.id}
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                const target = targetFor(entry.type);
                if (target) store.insertBlock(entry.type, target, entry.preset ?? {});
              }}
            >
              {t(entry.label)}
            </Button>
          ))}
        </div>
      ))}
      <p className="text-xs text-text-muted">{t('palette.hint')}</p>
    </aside>
  );
}
