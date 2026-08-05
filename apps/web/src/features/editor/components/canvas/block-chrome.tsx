'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { FlatItem } from '../../model/tree';
import { BlockToolbar } from './block-toolbar';
import { InsertBetween } from './insert-between';

/**
 * Ovládací obal jednoho bloku na plátně.
 *
 * Zásada: **obal nesmí měnit rozměry ani polohu obsahu.** Plátno má vypadat
 * jako hotový e-mail, takže výběr se kreslí `outline` se záporným odsazením
 * (nezabírá místo, na rozdíl od `border`), ovládání i tlačítko „+" jsou
 * absolutně pozicované a vytažené z toku. Dřívější obal měl `p-2`, `gap-1`
 * a odsazení podle úrovně, takže se e-mail na plátně rozjížděl proti tomu,
 * jak vypadal ve skutečnosti.
 *
 * Tlačítko „+" a ovládání bydlí **uvnitř** položky stromu. Vedle ní by ze
 * stromu udělaly `tree > button`, což axe hlásí jako `aria-required-children`:
 * strom smí obsahovat jen položky a skupiny.
 */
export function BlockChrome(props: {
  item: FlatItem;
  isSelected: boolean;
  /**
   * Píše uživatel PRÁVĚ TEĎ do textu tohohle bloku?
   *
   * Ovládání bloku se v tom případě nekreslí. Naměřený nález: zadavatel psal
   * text a přes řádek mu visely šipky, duplikace a koš, takže neviděl, co píše.
   * Ovládání se týká bloku jako celku (posunout, zdvojit, smazat), a to je jiný
   * úmysl než psát do něj větu; k tomu prvnímu se člověk dostane klávesou Esc
   * nebo kliknutím vedle, čímž psaní opustí a ovládání se objeví.
   */
  isEditing: boolean;
  isFocusStop: boolean;
  isHovered: boolean;
  label: string;
  locked: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
  dragHandle?: ReactNode;
  children: ReactNode;
}) {
  const { item, isSelected, isEditing, isFocusStop, isHovered, locked, onSelect, onHover } = props;
  const t = useTranslations('editor');
  const ref = useRef<HTMLDivElement>(null);
  const active = isSelected || isHovered;

  useEffect(() => {
    // Fokus se posouvá jen na vybraný blok, a jen když ho zrovna nemá něco
    // uvnitř. Bez té podmínky by výběr při psaní ukradl fokus editoru textu.
    if (!isSelected) return;
    const node = ref.current;
    if (!node) return;
    if (node.contains(window.document.activeElement)) return;
    node.focus({ preventScroll: false });
  }, [isSelected]);

  return (
    <div role="none" className="relative">
      <div
        ref={ref}
        role="treeitem"
        /*
         * Zvýrazňuje se jen blok POD KURZOREM, ne jeho předci.
         *
         * Tailwindí `group-hover` na to nestačí: bloky jsou zanořené (sekce
         * obsahuje text) a při najetí na text se rozsvítila i sekce, takže
         * plátno bylo plné čárkovaných rámečků a tlačítek „+" naráz.
         * `onMouseOver` probublává, takže `stopPropagation` nechá vyhrát
         * nejvnitřnější blok, což je přesně ten, na který uživatel míří.
         */
        onMouseOver={(event) => {
          event.stopPropagation();
          onHover(item.block.id);
        }}
        onMouseOut={(event) => {
          event.stopPropagation();
          onHover(null);
        }}
        data-testid={`block-${item.block.id}`}
        data-locked={locked ? 'true' : undefined}
        aria-level={item.level}
        aria-posinset={item.index + 1}
        aria-setsize={item.siblings}
        aria-selected={isSelected}
        aria-label={props.label}
        tabIndex={isFocusStop ? 0 : -1}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        /*
         * Vybírá se jen tehdy, když fokus přistál NA položce, ne uvnitř ní.
         *
         * Fokusové události v Reactu probublávají, a tlačítko „+" i ovládání
         * bloku bydlí uvnitř položky. Po zavření nabídky vrací Radix fokus na
         * spouštěč, tedy dovnitř PŮVODNÍHO bloku, a `onFocus` tím přepsal výběr
         * zpátky na něj: uživatel přidal blok a panel vlastností mu ukazoval
         * ten předchozí.
         */
        onFocus={(event) => {
          if (event.target === event.currentTarget) onSelect();
        }}
        className="relative outline-none"
        style={{
          outline: isSelected ? '2px solid var(--color-primary)' : undefined,
          outlineOffset: '-2px',
        }}
      >
        {item.block.visibleWhen ? (
          <p
            className="absolute left-2 top-1 z-20 rounded bg-surface-overlay px-2 py-0.5 text-xs text-text-muted shadow-sm"
            contentEditable={false}
          >
            {t('visibility.badge', {
              field: item.block.visibleWhen.field,
              op: t(`visibility.op.${item.block.visibleWhen.op}`),
            })}
          </p>
        ) : null}

        {/* Slabý obrys při najetí myší. Ukazuje, kam klik dopadne, a přitom
            nekřičí přes obsah e-mailu. */}
        {!isSelected && isHovered ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10"
            style={{ outline: '1px dashed var(--color-border-strong)', outlineOffset: '-1px' }}
          />
        ) : null}

        {props.children}

        {isSelected && !isEditing ? <BlockToolbar blockId={item.block.id} /> : null}

        {/* „+" sedí na spodní hraně bloku, tedy přesně tam, kam se blok vloží.
            Zůstává v DOM i skryté, aby ho našla klávesová cesta a testy.

            Při psaní je schované ze stejného důvodu jako ovládání bloku: sedí
            na hraně řádku, do kterého se píše. Zůstává v DOM, jen průhledné,
            takže klávesová cesta i testy ho pořád najdou.

            PRŮHLEDNÉ NESTAČÍ, MUSÍ BÝT I NEPROKLIKNUTELNÉ. `opacity: 0` mizí
            jen očím; prvek dál leží přes celou šířku bloku a bere si kliknutí.
            Naměřeno při ověřování v prohlížeči: klik do posledního řádku textu
            se vůbec nedostal k písmenu, protože ho tenhle pruh spolkl, a hlásil
            se jako „subtree intercepts pointer events". Uživatel klikne na
            konec odstavce a nic se nestane, což vypadá jako zamrzlý editor.

            Ukazatel se proto zapíná a vypíná spolu s viditelností. Klávesovou
            cestu to neomezuje: `pointer-events` se týkají myši, ne fokusu,
            takže `focus-within` pruh pořád rozsvítí. */}
        <div
          className={`absolute inset-x-0 -bottom-3 z-20 flex justify-center focus-within:pointer-events-auto focus-within:opacity-100 ${
            active && !isEditing ? '' : 'pointer-events-none'
          }`}
          style={{ opacity: active && !isEditing ? 1 : 0 }}
        >
          <InsertBetween item={item} />
        </div>
      </div>
      {props.dragHandle ?? null}
    </div>
  );
}
