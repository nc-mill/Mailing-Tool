'use client';

import { Button } from '@mlain/ui/components/button';
import { Tooltip, TooltipProvider } from '@mlain/ui/components/tooltip';
import { useTranslations } from 'next-intl';
import { TOOLBAR_OPERATIONS } from '../../keyboard/operations';
import { runOperation } from '../../keyboard/run-operation';
import { useEditorStore } from '../../state/use-editor';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Trash2 } from '../icons';

const ICONS = {
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  copy: Copy,
  trash: Trash2,
} as const;

/** Sada tlačítek se generuje z registru operací, takže myš nikdy nemá víc možností než klávesnice. */
export function BlockToolbar({ blockId }: { blockId: string }) {
  const t = useTranslations('editor');
  const store = useEditorStore();

  return (
    // `TooltipProvider` je tady, ne až v skořápce: ovládání bloku se vykresluje
    // i samostatně v testech a Radix bez poskytovatele vyhodí výjimku.
    <TooltipProvider>
      <div
        data-testid={`block-toolbar-${blockId}`}
        className="absolute -top-3 right-2 flex gap-1 rounded-md border border-border bg-surface p-1 shadow-sm"
      >
        {TOOLBAR_OPERATIONS.map((operation) => {
          const Icon = operation.icon ? ICONS[operation.icon] : null;
          return (
            <Tooltip key={operation.id} content={`${t(operation.labelKey)} (${operation.keys[0]})`}>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-8 px-2"
                aria-label={t(operation.labelKey)}
                onClick={(event) => {
                  event.stopPropagation();
                  runOperation(store, operation.id);
                }}
              >
                {Icon ? <Icon aria-hidden className="size-4" /> : null}
              </Button>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
