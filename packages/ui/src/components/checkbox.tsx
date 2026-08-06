'use client';

import { Checkbox as RadixCheckbox } from 'radix-ui';
import { Check } from '../icons';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Zaškrtávátko.
 *
 * Dvě velikosti, obě z návrhu: **18 px ve formuláři** a **16 px v řádku
 * tabulky**, kde jich je pod sebou padesát a osmnáctka by z prvního sloupce
 * udělala mřížku čtverečků. Velikosti mají vlastní tokeny `--size-choice*`,
 * ne `--size-icon-*`: je to ovládací prvek, ne kresba, a musí jít změnit
 * zvlášť od ikon, i když dnes vycházejí na stejné číslo.
 */
export const Checkbox = forwardRef<
  ElementRef<typeof RadixCheckbox.Root>,
  ComponentPropsWithoutRef<typeof RadixCheckbox.Root> & { dense?: boolean }
>(function Checkbox({ className, dense = false, ...props }, ref) {
  return (
    <RadixCheckbox.Root
      {...props}
      ref={ref}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[var(--radius-control)]',
        dense ? 'size-[var(--size-choice-dense)]' : 'size-[var(--size-choice)]',
        'border border-border-strong bg-field',
        'data-[state=checked]:border-edge data-[state=checked]:bg-panel',
        className,
      )}
    >
      <RadixCheckbox.Indicator className="text-panel-foreground">
        <Check aria-hidden className={dense ? 'icon-2xs' : 'icon-xs'} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
});
