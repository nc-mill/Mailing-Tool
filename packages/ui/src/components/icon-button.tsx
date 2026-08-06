'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)]',
    'transition-[background-color,box-shadow,transform,border-color] duration-[var(--duration-fast)]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        /** Hairline rámeček, tlumená ikona. Pro akce vedle hlavní akce. */
        quiet:
          'border border-border bg-transparent text-text-muted hover:bg-surface-muted hover:text-text',
        /** Tmavý rámeček s hranou. Pro akci, která je na stránce plnohodnotná. */
        solid: [
          'border border-edge bg-transparent text-text',
          'shadow-[0_var(--edge-raised)_0_var(--color-edge)]',
          'hover:bg-surface-muted hover:translate-y-[var(--edge-travel)]',
          'hover:shadow-[0_var(--edge-pressed)_0_var(--color-edge)]',
        ],
        /**
         * Obrysová destruktivní: rámeček, hrana i ikona v barvě nebezpečí,
         * plocha průhledná. Návrh takhle kreslí „Smazat kontakt": akce má být
         * vidět, ale nemá na obrazovce svítit jako plná červená plocha.
         */
        danger: [
          'border border-danger bg-transparent text-danger-text',
          'shadow-[0_var(--edge-raised)_0_var(--color-danger)]',
          'hover:bg-danger-surface hover:translate-y-[var(--edge-travel)]',
          'hover:shadow-[0_var(--edge-pressed)_0_var(--color-danger)]',
        ],
        /** Bez rámečku, dokud na něj uživatel nenajede. Pro řádek tabulky. */
        ghost:
          'border border-transparent bg-transparent text-text-muted hover:border-border-strong hover:bg-field hover:text-text',
      },
      size: {
        /** 44 px: hlavička obrazovky. */
        md: 'size-[var(--size-target-min)]',
        /** 40 px: lišta filtrů, hlavička aplikace. */
        sm: 'size-[var(--size-control)]',
        /** 36 px: stránkování, pruh hromadného výběru. */
        xs: 'size-[var(--size-control-sm)]',
        /** 34 px: ikonová akce uvnitř řádku tabulky. */
        row: 'size-[var(--size-control-xs)]',
      },
    },
    defaultVariants: { variant: 'quiet', size: 'md' },
  },
);

export type IconButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> &
  VariantProps<typeof iconButtonVariants> & {
    /** Ikona. Velikost si nastavuje sama třídou `icon-*`. */
    icon: React.ReactNode;
    /**
     * Název akce. POVINNÝ, protože tlačítko nemá viditelný text: bez něj by
     * ho čtečka přečetla jako „tlačítko" a hlasové ovládání by ho nenašlo.
     * Používá se i jako `title`, takže se ukáže v bublině prohlížeče.
     */
    label: string;
  };

/**
 * Čtvercové tlačítko s ikonou a bez viditelného textu.
 *
 * PROČ NENÍ `Button`: `Button` je obdélník, kterému šířku určuje jméno akce,
 * a má vnitřní vodorovný okraj. Tohle je čtverec o pevné straně, kde je jméno
 * akce jen v bublině. Jsou to dva různé prvky návrhu, ne dvě velikosti
 * jednoho, a míchání by znamenalo, že se každý ze čtverců vykreslí jinak
 * široký podle délky svého `aria-label`.
 *
 * V návrzích jsou právě dvě podoby: tichá s hairline rámečkem (import, export,
 * nastavení sloupců) a plná s hranou (archivace seznamu). Třetí, `ghost`,
 * je pro ikonovou akci v řádku tabulky, kde rámeček naskočí až při najetí,
 * aby padesát řádků nevypadalo jako mřížka tlačítek.
 *
 * BUBLINU S POPISEM si komponenta nekreslí. Když ji akce potřebuje, obalí se
 * `Tooltip`em; `title` je tu jako záchranná síť pro případ, že se na to
 * zapomene.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant, size, className, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? 'button'}
      aria-label={label}
      title={rest.title ?? label}
      className={cn(iconButtonVariants({ variant, size }), className)}
    >
      {icon}
    </button>
  );
});
