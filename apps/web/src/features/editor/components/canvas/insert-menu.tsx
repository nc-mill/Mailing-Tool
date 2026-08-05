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
import { canContain, typeAt } from '../../model/tree';
import type { Path } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { Plus } from '../icons';

/**
 * Nabídka „přidej blok sem".
 *
 * Jedno místo pro obě situace: mezi dva bloky (tlačítko na spodní hraně bloku)
 * a dovnitř prázdného sloupce. Nabízí jen to, co gramatika dokumentu na daném
 * místě dovolí (`canContain`), takže se do sloupce nedá vložit sekce a do sekce
 * další sekce. Gramatika se bere z modelu, ne z odhadu.
 *
 * ODCHYLKA OD PLÁNU: `DropdownMenuLabel` z `@mlain/ui/components/dropdown-menu`
 * neexistuje, obal P05 vystavuje jen `DropdownMenu`, `DropdownMenuTrigger`,
 * `DropdownMenuContent`, `DropdownMenuItem` a `DropdownMenuSeparator`. Nadpis
 * skupiny se proto kreslí obyčejným odstavcem.
 */
export function InsertMenu({
  parent,
  index,
  label,
  testId,
}: {
  parent: Path;
  index: number;
  label: string;
  testId: string;
}) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const parentType = typeAt(document, parent);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="min-h-6 px-2"
          // Mimo tabulátor ze stejného důvodu jako ovládání bloku: plátno má
          // jediný tabstop. Klávesnice vkládá blok zkratkou `Mod+Enter`.
          tabIndex={-1}
          data-testid={testId}
          aria-label={label}
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
  );
}
