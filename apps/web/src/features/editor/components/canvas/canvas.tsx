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
 * Prvky, které si vstup obsluhují samy a plátno jim do něj nesmí mluvit.
 *
 * JEDNA KONSTANTA PRO VŠECHNY OBSLUHY NA OBALU, ne opsaný řetězec u každé.
 * Plátno je obal, do kterého probublávají události ze všeho uvnitř, a přesně
 * na tomhle vzorci projekt 6. 8. 2026 uklouzl třikrát za dopoledne (viz
 * `docs/superpowers/DESIGN-INTEGRACE.md`, kapitola 7): obsluha na obalu, která
 * nevyjímá ovládací prvky uvnitř. V `data-table.tsx` se to stalo dvakrát tím,
 * že výjimka existovala jen pro jednu ze dvou cest a druhá se s ní rozešla.
 *
 * `[data-inline-editor]` je pole pro psaní textu, zbytek jsou formulářové prvky
 * plovoucí lišty (adresa odkazu, výběry). Kdo sem sáhne, mění chování všech
 * obsluh naráz, což je záměr.
 */
const SELF_HANDLING = 'input, textarea, select, [data-inline-editor]';

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

  /**
   * Konec psaní S VRÁCENÍM FOKUSU NA BLOK.
   *
   * Pole pro psaní se odchodem z něj odmontuje (`InlineRichText` ustoupí
   * `RichView`) a fokus, který na něm stál, spadne na `<body>`. Naměřeno
   * v prohlížeči: po Esc hlásil `document.activeElement` `BODY`. Od té chvíle
   * nedojde na plátno ŽÁDNÁ klávesa, protože události chodí z fokusovaného
   * prvku a `<body>` uvnitř stromu neleží. Klávesová cesta k blokům tím po
   * každém psaní tiše končila; všimlo se toho až ve chvíli, kdy měla druhá
   * klávesa něco udělat.
   *
   * Prvek se hledá v DOM, ne přes `ref`: obal bloku patří `BlockChrome`
   * a plátno na něj odkaz nemá. `data-testid` je jeho stabilní jméno,
   * používají ho i testy.
   */
  const stopEditing = (blockId: string | null) => {
    const wrapper =
      blockId === null
        ? null
        : window.document.querySelector<HTMLElement>(`[data-testid="block-${blockId}"]`);
    setEditingId(null);
    wrapper?.focus();
  };

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
      stopEditing(editingId);
      return;
    }

    /*
     * DRUHÝ Esc ODZNAČÍ BLOK, a tím vrátí panel vlastností na Motiv.
     *
     * Nastavení motivu se ukazuje jen tehdy, když není vybraný žádný blok,
     * takže po prvním kliknutí do e-mailu k němu klávesnicí nevedla žádná cesta.
     *
     * Je to DRUHÝ krok téže klávesy, ne první: první Esc opouští psaní (větev
     * výš) a je z něj vidět, co se stalo, protože se nad blokem znovu objeví
     * jeho ovládání a tlačítko „+" (`BlockChrome`, podmínka `isSelected &&
     * !isEditing`). Kdyby první stisk nic viditelného neudělal, vypadala by
     * klávesa jako nefunkční.
     *
     * Co si klávesnici obsluhuje samo, tomu se do ní nemluví: pole odkazu
     * v plovoucí liště leží uvnitř stromu a Esc v něm zavírá lištu, ne výběr
     * bloku. Táž úvaha jako u pojistek níž, jen musí stát tady, protože ty
     * běží až po větvi Escape.
     */
    if (event.key === 'Escape' && selectedId !== null) {
      if ((event.target as HTMLElement).closest(SELF_HANDLING)) return;
      event.preventDefault();
      store.select(null);
      return;
    }

    /*
     * Dokud vstup drží něco, co si ho obsluhuje samo, patří klávesnice jemu.
     *
     * Bez téhle pojistky by šipky uvnitř `contenteditable` zároveň posouvaly
     * výběr po stromu a `Backspace` na konci slova by kromě znaku smazal
     * i celý blok. Událost probublává až sem, takže se to musí odchytit tady,
     * ne v editoru.
     *
     * Týká se to i plovoucí lišty u textu: má pole pro adresu odkazu a leží
     * uvnitř stromu, takže sem probublají i klávesy z ní. Naměřeno v prohlížeči:
     * `Backspace` při psaní adresy nesmazal znak, ale celý blok (pět položek
     * stromu před, čtyři po), a `Enter` neodeslal formulář, protože
     * `matchOperation` obojí spároval s operací nad blokem a zavolal
     * `preventDefault`. Šipky by ze stejného důvodu skákaly po stromu místo
     * po napsaném textu.
     *
     * Rozhoduje typ prvku, ne jeho umístění, a výčet je jediný (`SELF_HANDLING`),
     * takže se tahle pojistka nemůže rozejít s tou ve větvi Escape výš.
     */
    if ((event.target as HTMLElement).closest(SELF_HANDLING)) return;

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
        // Esc uvnitř textu si odchytí Tiptap sám a ohlásí ho sem, takže větev
        // v `onKeyDown` na něj vůbec nedojde. Fokus se proto musí vracet i tady,
        // jinak po prvním Esc spadne na `<body>` a druhý už nikam nedojde.
        onExit={() => stopEditing(slot.block.id)}
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
    <div className="flex min-w-0 flex-col gap-[var(--spacing-inline)]">
      {/*
        Plátno je KARTA, jak ho kreslí návrh: hairline rámeček, rádius 10 px
        a vnitřní okraj 25 px. Plochu ale NEDÁVÁ systém, dává ji dokument
        (`surface.canvas` z motivu), protože uživatel si ji volí v panelu
        motivu a musí ji vidět přesně tak, jak dojde příjemci.
      */}
      <div
        className="w-full rounded-[var(--radius-surface)] border border-border p-[var(--spacing-card-tight)]"
        style={{
          backgroundColor: darkOverride('surface.canvas', theme.light.roles['surface.canvas']),
        }}
        /*
         * KLIK MIMO BLOK ukončí psaní A ZRUŠÍ VÝBĚR, takže se panel vlastností
         * vrátí na Motiv.
         *
         * Dřív tady stálo jen `setEditingId(null)` a výběr zůstával, takže se
         * uživatel k nastavení pozadí, písem a šířky po prvním kliknutí do
         * e-mailu nedostal jinak než znovunačtením stránky.
         *
         * PROČ TO NEUBLÍŽÍ PRÁCI S BLOKY: klik na blok se sem vůbec nedostane.
         * `BlockChrome` na své položce volá `event.stopPropagation()`, takže
         * tenhle obsluhovač běží jen pro kliknutí, která nedopadla na žádný
         * blok. Totéž platí pro ovládání bloku, tlačítko „+" i nabídky, protože
         * všechny bydlí uvnitř položky.
         *
         * Zbývá jediný případ, kdy se sem klik z bloku dostane: uživatel začne
         * TÁHNOUT VÝBĚR TEXTU uvnitř bloku a pustí tlačítko až venku na ploše.
         * Klik pak nevznikne na bloku, ale na jejich společném předkovi, tedy
         * tady. Proto se nejdřív ptáme na výběr textu: dokud je v okně něco
         * označeného, uživatel právě vybíral text a o blok nepřišel.
         */
        onClick={(event) => {
          setEditingId(null);
          // Týž výčet jako u klávesnice, ať se obě cesty nerozejdou. Sem se
          // klik z ovládacího prvku dostane jen přes plovoucí vrstvu mimo blok,
          // ale pravidlo z kapitoly 7 zní, že výjimka má být na OBOU cestách.
          if ((event.target as HTMLElement).closest(SELF_HANDLING)) return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
          store.select(null);
        }}
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
      {/*
        Řádek pod plátnem říká, co je vidět a jak je to široké. Návrh ho má
        UVNITŘ karty, ale tam by ležel na ploše, kterou si volí uživatel:
        na inkoustovém plátně by tlumený text zmizel. Stojí proto pod kartou,
        na papíru stránky, kde je čitelný vždycky. Je mono, protože se čte
        po číslicích.
      */}
      <p className="text-center font-mono text-label text-text-muted">
        {mobile
          ? t('canvas.noteMobile', { width: viewport })
          : t('canvas.noteDesktop', { width: viewport })}
      </p>
    </div>
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
