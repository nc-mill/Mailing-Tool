'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { EDITOR_DND_ENABLED } from '../../config';
import { descriptorFor } from '../../descriptors/registry';
import { useCanvasKeyboard } from '../../keyboard/use-canvas-keyboard';
import type { EditorBlock, RichText } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import type { FlatItem, Path } from '../../model/tree';
import { flatten, typeAt } from '../../model/tree';
import type { EditorPorts } from '../../ports/types';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { BlockChrome } from './block-chrome';
import { acceptsDrop } from './dnd/accepts';
import { useDragPayload } from './dnd/dnd-canvas';
import { DraggableBlock } from './dnd/draggable-block';
import { DropSlot } from './dnd/drop-slot';
import { EmptySlot } from './dnd/empty-slot';
import { AssetPickerDialog } from './render/asset-picker-dialog';
import type { RichSlot } from './render/block-view';
import { BlockView } from './render/block-view';
import { CanvasProvider, useCanvas } from './render/canvas-context';
import { InlineRichText } from './render/inline-rich-text';
import { RichView } from './render/rich-view';
import { useView } from '../view/view-state';

export type CanvasProps = {
  canWriteHtml: boolean;
  fieldCatalog: FieldCatalog;
  ports?: EditorPorts | undefined;
};

/**
 * Plátno editoru.
 *
 * Proti dřívějšímu znění se změnilo těžiště: plátno už není odsazený seznam
 * položek stromu s abstraktními popisky („Sekce", „Nadpis"), ale e-mail v té
 * podobě, v jaké dojde příjemci. Text se píše přímo do něj.
 *
 * Přístupnostní kostra z P12 zůstává: `role="tree"`, jediný tabstop, roving
 * tabindex a klávesové operace `Alt+↑/↓/←/→`. Mění se jen to, jak položky
 * stromu vypadají.
 */
export function Canvas(props: CanvasProps) {
  const document = useEditorState((state) => state.document);
  const [assetTarget, setAssetTarget] = useState<{ blockId: string; key: string } | null>(null);
  // Nastavení zobrazení z hlavičky. Plátno je čte, ale nedrží: jediný stav
  // o tom, co se ukazuje, žije v `ViewProvider` a používá ho i náhled.
  const view = useView();

  const pickAsset = useCallback((blockId: string, key: string) => {
    setAssetTarget({ blockId, key });
  }, []);

  return (
    <CanvasProvider
      theme={document.theme}
      ports={props.ports}
      pickAsset={pickAsset}
      mobile={view.mode === 'mobile'}
      dark={view.dark}
      values={view.values}
    >
      <CanvasBody {...props} />
      {/* Dialog musí být UVNITŘ poskytovatele: po výběru doplňuje obrázek do
          mapy plátna, aby se nově nahraný soubor hned vykreslil. */}
      <CanvasAssetPicker
        target={assetTarget}
        ports={props.ports}
        onDone={() => setAssetTarget(null)}
      />
    </CanvasProvider>
  );
}

function CanvasAssetPicker(props: {
  target: { blockId: string; key: string } | null;
  ports: EditorPorts | undefined;
  onDone: () => void;
}) {
  const store = useEditorStore();
  const { addAsset } = useCanvas();
  const { target, onDone } = props;
  return (
    <AssetPickerDialog
      open={target !== null}
      ports={props.ports}
      onPick={(asset) => {
        if (target) {
          addAsset(asset);
          store.patchProps(target.blockId, { [target.key]: asset.id });
        }
        onDone();
      }}
      onClose={onDone}
    />
  );
}

function CanvasBody({ canWriteHtml, fieldCatalog }: CanvasProps) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const { theme, viewport, mobile, darkOverride } = useCanvas();
  const document = useEditorState((state) => state.document);
  const selectedId = useEditorState((state) => state.selectedId);
  /** Blok, do jehož textu uživatel vstoupil. Nejvýš jeden naráz. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Blok pod kurzorem. Drží se ve stavu, ne v CSS, kvůli zanoření bloků. */
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const items = useMemo(() => flatten(document), [document]);
  const focusId = selectedId ?? items[0]?.block.id ?? null;
  /** Co se právě táhne. `null` mimo tažení, a pak se místa upuštění nekreslí. */
  const dragPayload = useDragPayload();

  const canvasKeyDown = useCanvasKeyboard({
    onFocusProperties: () => {
      const panel = window.document.getElementById('editor-properties');
      panel?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    },
    onUndoOffer: () => {
      window.dispatchEvent(new CustomEvent('editor:undo-offer'));
    },
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    /*
     * Esc opouští psaní, ať fokus drží cokoliv, a stojí PŘED pojistkou níž.
     *
     * Uvnitř textu tutéž klávesu odchytí i Tiptap (`editorProps.handleKeyDown`),
     * ale spolehnout se na něj nejde: fokus umí být na obalu bloku, ne na
     * `contenteditable`, a pak by se z psaní nedalo vystoupit klávesnicí vůbec.
     * Od chvíle, kdy se ovládání bloku při psaní schovává, je to jediná
     * klávesová cesta zpátky k němu, takže tady být musí. Dvojí obsloužení
     * nevadí, `setEditingId(null)` je idempotentní.
     */
    if (event.key === 'Escape' && editingId !== null) {
      event.preventDefault();
      setEditingId(null);
      return;
    }

    /*
     * Dokud je fokus uvnitř textu, patří klávesnice textu.
     *
     * Bez téhle pojistky by šipky uvnitř `contenteditable` zároveň posouvaly
     * výběr po stromu a `Backspace` na konci slova by kromě znaku smazal
     * i celý blok. Událost probublává až sem, takže se to musí odchytit tady,
     * ne v editoru.
     */
    if ((event.target as HTMLElement).closest('[data-inline-editor]')) return;

    if (event.key === 'Enter' && selectedId && richKeyOf(blockById(items, selectedId))) {
      event.preventDefault();
      setEditingId(selectedId);
      return;
    }
    canvasKeyDown(event);
  };

  const renderRich = (slot: RichSlot): ReactNode => {
    const richProp = richDescriptorOf(slot.block.type, slot.propKey);
    if (slot.block.id !== editingId || !richProp) {
      return (
        <RichView
          value={slot.value as RichText}
          color={slot.color}
          linkColor={slot.linkColor}
          align={slot.align}
          style={slot.style}
          inline={slot.inline}
        />
      );
    }
    return (
      <InlineRichText
        value={slot.value as RichText}
        onChange={(next) => store.patchProps(slot.block.id, { [slot.propKey]: next })}
        onExit={() => setEditingId(null)}
        allowLists={richProp.allowLists}
        singleParagraph={richProp.singleParagraph}
        fieldCatalog={fieldCatalog}
        align={slot.align}
        style={slot.style}
        inline={slot.inline}
      />
    );
  };

  /** Smí náklad do tohohle rodiče? Táž čistá funkce, jakou používá vrstva tažení. */
  const accepts = (parent: Path): boolean =>
    dragPayload !== null && acceptsDrop(document, dragPayload, parent);

  /**
   * Seznam potomků i s místy upuštění mezi nimi.
   *
   * Tohle je jádro opravy: místa upuštění vznikají na KAŽDÉ úrovni, tedy i uvnitř
   * sloupce, protože se kreslí tam, kde se kreslí seznam potomků. Dřív existoval
   * jediný plochý seznam sourozenců a blok se nedal upustit dovnitř ničeho.
   */
  const renderList = (children: EditorBlock[], childWidth: number, parent: Path): ReactNode => {
    // Prázdný kořen dokumentu výzvu nepotřebuje: sekci přidá paleta i „+".
    if (children.length === 0 && parent.length > 0) {
      return (
        <EmptySlot
          parent={parent}
          accepts={accepts(parent)}
          label={t(
            typeAt(document, parent) === 'column' ? 'canvas.emptyColumn' : 'canvas.emptySection',
          )}
        />
      );
    }
    return (
      <>
        {children.map((child, index) => (
          <Fragment key={child.id}>
            <DropSlot parent={parent} index={index} accepts={accepts(parent)} />
            {renderBlock(child, childWidth, [...parent, index], children.length)}
          </Fragment>
        ))}
        <DropSlot parent={parent} index={children.length} accepts={accepts(parent)} />
      </>
    );
  };

  /** Rekurzivní vykreslení: blok se obalí ovládáním a uvnitř se kreslí jeho podoba. */
  const renderBlock = (
    block: EditorBlock,
    width: number,
    path: Path,
    siblings: number,
  ): ReactNode => {
    const item: FlatItem = {
      block,
      path,
      level: path.length,
      index: path[path.length - 1] ?? 0,
      siblings,
    };
    const descriptor = descriptorFor(block.type);
    const locked = descriptor.type === block.type && descriptor.groups.length === 0;

    const view = (
      <BlockView
        block={block}
        width={width}
        canWriteHtml={canWriteHtml}
        renderRich={renderRich}
        renderChild={(child, childWidth) =>
          renderBlock(
            child,
            childWidth,
            [...path, (block.children ?? []).indexOf(child)],
            (block.children ?? []).length,
          )
        }
        renderList={(children, childWidth) => renderList(children, childWidth, path)}
      />
    );

    const chrome = (dragHandle: ReactNode) => (
      <BlockChrome
        item={item}
        isSelected={block.id === selectedId}
        isEditing={block.id === editingId}
        isFocusStop={block.id === focusId}
        isHovered={block.id === hoveredId}
        onHover={setHoveredId}
        label={t(descriptor.label)}
        locked={locked}
        dragHandle={dragHandle}
        onSelect={() => {
          store.select(block.id);
          // Klik do textového bloku rovnou otevře psaní. To je celé jádro
          // WYSIWYG: uživatel klikne tam, kde chce psát, a píše.
          setEditingId(richKeyOf(block) ? block.id : null);
        }}
      >
        {view}
      </BlockChrome>
    );

    // Sloupec sám o sobě není samostatná položka k výběru: uživatel vybírá
    // rozvržení nebo blok uvnitř. Kreslí se proto bez obalu.
    if (block.type === 'column') return <div key={block.id}>{view}</div>;

    return EDITOR_DND_ENABLED ? (
      <DraggableBlock
        key={block.id}
        id={block.id}
        blockType={block.type}
        label={t(descriptor.label)}
      >
        {(dragHandle) => chrome(dragHandle)}
      </DraggableBlock>
    ) : (
      <div key={block.id} role="none">
        {chrome(null)}
      </div>
    );
  };

  return (
    <>
      <div
        className="min-h-full w-full"
        style={{
          backgroundColor: darkOverride('surface.canvas', theme.light.roles['surface.canvas']),
        }}
        // Klik mimo blok ukončí psaní, ale výběr nechá být: uživatel se často
        // jen potřebuje podívat, jak text vypadá bez kurzoru.
        onClick={() => setEditingId(null)}
      >
        <div
          role="tree"
          aria-label={t('a11y.canvas')}
          aria-multiselectable={false}
          onKeyDown={onKeyDown}
          data-dnd={EDITOR_DND_ENABLED ? 'on' : 'off'}
          data-viewport={mobile ? 'mobile' : 'desktop'}
          className="mx-auto outline-none"
          // Mobilní zobrazení zúží plochu na 375 px a tím se chytnou tatáž
          // pravidla, jaká emitter posílá v `@media`. Na počítači zůstává
          // šířka obsahu z motivu (600 nebo 640 px).
          style={
            mobile
              ? {
                  width: `${viewport}px`,
                  maxWidth: '100%',
                  boxShadow: '0 0 0 1px var(--color-border)',
                }
              : { maxWidth: '100%', width: 'fit-content', minWidth: `${viewport}px` }
          }
        >
          {/* Kořen dokumentu: mezi sekcemi jsou tatáž místa upuštění jako
              uvnitř sekcí a sloupců, jen sem smí výhradně sekce. */}
          {renderList(document.blocks, viewport, [])}
        </div>
      </div>
    </>
  );
}

function blockById(items: FlatItem[], id: string): EditorBlock | undefined {
  return items.find((item) => item.block.id === id)?.block;
}

/** Klíč vlastnosti s bohatým textem, nebo `null` u bloku, který text nemá. */
function richKeyOf(block: EditorBlock | undefined): string | null {
  if (!block) return null;
  for (const group of descriptorFor(block.type).groups) {
    for (const prop of group.props) {
      if (prop.kind === 'richtext') return prop.key;
    }
  }
  return null;
}

function richDescriptorOf(
  type: string,
  key: string,
): { allowLists: boolean; singleParagraph?: boolean | undefined } | null {
  for (const group of descriptorFor(type).groups) {
    for (const prop of group.props) {
      if (prop.kind === 'richtext' && prop.key === key) {
        return { allowLists: prop.allowLists, singleParagraph: prop.singleParagraph };
      }
    }
  }
  return null;
}
