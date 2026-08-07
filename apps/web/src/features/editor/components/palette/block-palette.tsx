'use client';

import { useDraggable } from '@dnd-kit/core';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { GripVertical } from '../icons';
import { useTranslations } from 'next-intl';
import { EDITOR_DND_ENABLED } from '../../config';
import { paletteFor } from '../../descriptors/registry';
import type { MoveTarget } from '../../model/ops';
import { canContain, findBlock, typeAt } from '../../model/tree';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { useTemplateProfile } from '../richtext/template-profile';

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
  // Paleta se řídí PROFILEM, ne druhem řádku: veřejná stránka nedostane patičku
  // ani blok syrového HTML (viz `paletteFor`). Profil je v kontextu, protože ho
  // potřebuje i nabídka personalizace pod třemi obaly.
  const palette = paletteFor(useTemplateProfile());

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

  /*
   * Paleta je KARTA, ne sloupec s dělicí linkou. Návrh ji kreslí stejně jako
   * ostatní panely editoru: papír, hairline rámeček, rádius 10 px, vnitřní
   * okraj 20 px. Nadpis je nadpis karty (19 px), názvy skupin jsou mono
   * verzálky, tedy táž dvojice jako v hlavičce tabulky.
   */
  /*
   * PALETA SE LEPÍ POD HLAVIČKU. Od chvíle, kdy roluje stránka a ne panely,
   * by paleta u dlouhého e-mailu odjela nahoru a blok by nebylo odkud vzít.
   * Lepí se pod horní lištu (`--size-topbar`) a když je vyšší než okno, roluje
   * si sama, což je přesně to, co uměl původní sloupec přes celou výšku.
   */
  return (
    <Card
      as="aside"
      aria-label={t('palette.title')}
      padding="sm"
      gap="none"
      className={[
        'gap-3',
        'sticky top-[calc(var(--size-topbar)+var(--spacing-stack))]',
        'max-h-[calc(100dvh-var(--size-topbar)-var(--spacing-page))] overflow-y-auto',
      ].join(' ')}
    >
      <CardTitle>{t('palette.title')}</CardTitle>
      {palette.map((group) => (
        <div key={group.label} className="flex flex-col gap-1.5">
          <p className="meta-caps text-text-muted">{t(group.label)}</p>
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
      <p className="text-meta text-text-muted">{t('palette.dragHint')}</p>
    </Card>
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

  /*
   * Položka palety NENÍ `Button` se spodní hranou. Návrh ji kreslí jako plochý
   * obdélník s hairline rámečkem, který při najetí ztmavne, protože se do ní
   * chytá a táhne; hrana „stojícího" tlačítka by u devíti položek pod sebou
   * dělala z panelu klávesnici.
   *
   * Výška zůstává 44 px, ne 38 px z návrhu: je to hlavní ovládací prvek panelu
   * a klikací plocha se kvůli vzhledu nezmenšuje.
   */
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={[
        'flex w-full min-h-[var(--size-target-min)] cursor-grab items-center gap-[var(--spacing-inline)]',
        'rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2',
        'text-left text-sm text-text',
        'transition-colors duration-[var(--duration-fast)]',
        'hover:border-border-strong hover:bg-surface-muted',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
      ].join(' ')}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      data-testid={`palette-${props.id}`}
      onClick={props.onClick}
      {...attributes}
      {...listeners}
      // `attributes` z knihovny nesou `role="button"` a `tabIndex`, což tlačítko
      // už má; přepsat je zpátky by rozbilo klávesovou cestu k vložení klikem.
      role={undefined}
    >
      {/* Úchop říká, že se položka dá táhnout. Význam nese slovo vedle něj. */}
      <GripVertical aria-hidden className="icon-xs shrink-0 text-border-strong" />
      {props.label}
    </button>
  );
}
