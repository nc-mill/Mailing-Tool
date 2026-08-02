'use client';

import { Button } from '@mlain/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { useTranslations } from 'next-intl';
import { PALETTE } from '../../descriptors/registry';
import type { FlatItem } from '../../model/tree';
import { canContain, typeAt } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { Plus } from '../icons';

/**
 * Přidání bloku tlačítkem mezi bloky. Nabízí se jen to, co gramatika na daném místě dovolí.
 *
 * ODCHYLKA OD PLÁNU: `DropdownMenuLabel` z `@mlain/ui/components/dropdown-menu`
 * neexistuje, obal P05 vystavuje jen `DropdownMenu`, `DropdownMenuTrigger`,
 * `DropdownMenuContent`, `DropdownMenuItem` a `DropdownMenuSeparator`. Nadpis
 * skupiny se proto kreslí obyčejným odstavcem.
 */
export function InsertBetween({ item }: { item: FlatItem }) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const parent = item.path.slice(0, -1);
  const parentType = typeAt(document, parent);
  const index = item.index + 1;

  return (
    <div className="flex h-6 items-center justify-center opacity-0 focus-within:opacity-100 group-hover:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            className="min-h-6 px-2"
            // Mimo tabulátor ze stejného důvodu jako ovládání bloku: plátno má
            // jediný tabstop. Klávesnice vkládá blok zkratkou `Mod+Enter`.
            tabIndex={-1}
            data-testid={`insert-after-${item.block.id}`}
            aria-label={t('insert.after', { block: t(`block.${item.block.type}`) })}
          >
            <Plus aria-hidden className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {PALETTE.map((group) => {
            const entries = group.entries.filter((entry) => canContain(parentType, entry.type));
            if (entries.length === 0) return null;
            return (
              <div key={group.label}>
                <p className="px-3 py-2 text-xs font-medium text-text-muted">{t(group.label)}</p>
                {entries.map((entry) => (
                  <DropdownMenuItem
                    key={entry.id}
                    onSelect={() =>
                      store.insertBlock(entry.type, { parent, index }, entry.preset ?? {})
                    }
                  >
                    {t(entry.label)}
                  </DropdownMenuItem>
                ))}
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
