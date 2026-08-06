'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Slot as RadixSlot } from 'radix-ui';
import { forwardRef, useId, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Tlačítko.
 *
 * VZHLED: obdélník s hairline rámečkem a plnou spodní hranou 3 px. Při najetí
 * myší tlačítko „dosedne": posune se o 2 px dolů a hrana se zkrátí na 1 px.
 * Není to stín ve smyslu vrstvení (systém stíny nemá), je to hrana tištěného
 * tlačítka. Utility `edge`, `edge-primary` a `*-pressed` jsou v `globals.css`.
 *
 * Uživateli, který si vypnul animace, se přechod nepřehraje (`globals.css`
 * zkracuje všechny přechody), ale tlačítko se stejně posune, takže zpětná
 * vazba na najetí zůstane.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-[var(--spacing-inline)] whitespace-normal text-center',
    'min-h-[var(--size-target-min)] rounded-[var(--radius-control)] px-5 text-base font-semibold no-underline',
    'transition-[background-color,box-shadow,transform] duration-[var(--duration-fast)]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        primary: [
          'border border-edge bg-primary text-primary-foreground',
          'shadow-[0_var(--edge-raised)_0_var(--color-edge-primary)]',
          'hover:bg-primary-hover hover:translate-y-[var(--edge-travel)]',
          'hover:shadow-[0_var(--edge-pressed)_0_var(--color-edge-primary)]',
        ],
        destructive: [
          'border border-edge bg-danger text-danger-foreground',
          'shadow-[0_var(--edge-raised)_0_var(--color-edge)]',
          'hover:brightness-110 hover:translate-y-[var(--edge-travel)]',
          'hover:shadow-[0_var(--edge-pressed)_0_var(--color-edge)]',
        ],
        // Obrysová destruktivní: rámeček, hrana i text v barvě nebezpečí,
        // plocha průhledná. Návrh ji používá pro mazání položky na jejím
        // vlastním detailu, kde má být akce vidět, ale nemá svítit jako plná
        // červená plocha vedle klidného obsahu.
        destructiveOutline: [
          'border border-danger bg-transparent text-danger-text',
          'shadow-[0_var(--edge-raised)_0_var(--color-danger)]',
          'hover:bg-danger-surface hover:translate-y-[var(--edge-travel)]',
          'hover:shadow-[0_var(--edge-pressed)_0_var(--color-danger)]',
        ],
        secondary: [
          'border border-edge bg-transparent text-text',
          'shadow-[0_var(--edge-raised)_0_var(--color-edge)]',
          'hover:bg-surface-muted hover:translate-y-[var(--edge-travel)]',
          'hover:shadow-[0_var(--edge-pressed)_0_var(--color-edge)]',
        ],
        // Tichá varianta: bez hrany, bez rámečku. Pro akce, které nemají
        // soupeřit s hlavním tlačítkem na stejné obrazovce.
        ghost: 'border border-transparent bg-transparent text-text hover:bg-surface-muted',
        link: 'min-h-0 border-0 bg-transparent px-0 text-ui font-normal text-accent-text underline underline-offset-[var(--underline-offset)]',
      },
      size: {
        sm: 'min-h-[var(--size-control-sm)] px-3.5 text-ui',
        md: 'min-h-[var(--size-target-min)] px-5 text-base',
        lg: 'min-h-12 px-6 text-body',
      },
    },
    // Odkazové tlačítko nemá rozměry tlačítka.
    //
    // VADA, KTEROU TO OPRAVUJE: `cva` skládá base → varianty → velikosti, takže
    // `size` přebíjelo to, co si `variant: 'link'` nastavil. Odkaz tedy dostal
    // `min-height: 44px` a vodorovný okraj 20 px a v textu kolem sebe dělal
    // díru. Compound varianta se vyhodnocuje AŽ PO velikosti, takže vyhraje.
    compoundVariants: [
      {
        variant: 'link',
        className: 'min-h-0 px-0 text-ui font-normal',
      },
    ],
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

type NativeProps = Omit<ComponentPropsWithoutRef<'button'>, 'disabled' | 'children'>;

type SharedProps = NativeProps &
  Pick<VariantProps<typeof buttonVariants>, 'size'> & {
    children: React.ReactNode;
    className?: string;
    /** Akce běží. Tlačítko zůstává čitelné a klikatelné, ale akci nespustí podruhé. */
    pending?: boolean;
    /** Text během čekání, například „Ukládáme…". Bez něj zůstává původní popisek. */
    pendingLabel?: string;
    /**
     * Nevykreslí `<button>`, ale předá vzhled svému JEDINÉMU potomkovi.
     *
     * K čemu to je: akce, která **musí zůstat odkazem**, protože se má dát
     * otevřít na novém panelu, zkopírovat adresa nebo poslat kolegovi.
     * Tlačítko nic z toho neumí, a `onClick` s `router.push` to nespraví:
     * prostřední tlačítko myši ani Cmd+klik na `<button>` nefungují.
     *
     * ```tsx
     * <Button asChild variant="primary">
     *   <Link href={`/w/${slug}/forms/new`}>Nový formulář</Link>
     * </Button>
     * ```
     *
     * Potomek musí být právě jeden prvek a musí umět přijmout `className`
     * a `ref`. `pending` a `unavailableReason` se s `asChild` nekombinují:
     * obojí řídí chování tlačítka, které tady žádné není.
     */
    asChild?: boolean;
  };

/**
 * Primární a destruktivní tlačítko `disabled` nepřijímá (princip P5, kritérium 18).
 * Když akci nejde provést, předá se `unavailableReason`: tlačítko zůstane funkční,
 * vysvětlí důvod a místo akce zavolá `onUnavailable`.
 */
type LoudProps = SharedProps & {
  variant: 'primary' | 'destructive' | 'destructiveOutline';
  disabled?: never;
  unavailableReason?: string;
  onUnavailable?: () => void;
};

type QuietProps = SharedProps & {
  variant?: 'secondary' | 'ghost' | 'link';
  disabled?: boolean;
  unavailableReason?: never;
  onUnavailable?: never;
};

export type ButtonProps = LoudProps | QuietProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    className,
    variant = 'secondary',
    size,
    children,
    pending = false,
    pendingLabel,
    onClick,
    unavailableReason,
    onUnavailable,
    asChild = false,
    ...rest
  } = props as SharedProps & {
    variant?: ButtonProps['variant'];
    unavailableReason?: string;
    onUnavailable?: () => void;
    disabled?: boolean;
  };
  const reasonId = useId();
  const isUnavailable = Boolean(unavailableReason);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (isUnavailable) {
      event.preventDefault();
      onUnavailable?.();
      return;
    }
    onClick?.(event);
  };

  // `Slot` propíše třídy a `ref` do potomka, `button` je vykreslí sám.
  // Typ `type` do odkazu nepatří, ten atribut má na `<a>` úplně jiný význam.
  const Element = asChild ? RadixSlot.Slot : 'button';

  return (
    <>
      <Element
        {...(rest as ComponentPropsWithoutRef<'button'>)}
        ref={ref}
        {...(asChild ? {} : { type: rest.type ?? 'button' })}
        aria-busy={pending ? true : undefined}
        aria-describedby={isUnavailable ? reasonId : rest['aria-describedby']}
        data-pending={pending ? '' : undefined}
        data-unavailable={isUnavailable ? '' : undefined}
        className={cn(
          buttonVariants({ variant, size }),
          isUnavailable ? 'opacity-80' : '',
          className,
        )}
        onClick={handleClick}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </Element>
      {isUnavailable ? (
        <span id={reasonId} className="mt-1 block text-ui text-text-muted">
          {unavailableReason}
        </span>
      ) : null}
    </>
  );
});
