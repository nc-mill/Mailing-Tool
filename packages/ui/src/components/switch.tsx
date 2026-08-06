'use client';

import { Switch as RadixSwitch } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Přepínač.
 *
 * ZAPNUTÝ JE ŽLUTÝ, kolečko světlé. Dřív to bylo naopak, tmavá dráha se
 * žlutým kolečkem, což vypadalo spíš jako vypnutý stav s ozdobou. Návrh
 * Seznamů (řádky 464 a 465) říká: dráha `#E4C258` zapnuto a `#F2ECDB`
 * vypnuto, kolečko vždycky `#FDFBF4`. Identitní barva patří stavu
 * „zapnuto", ne puntíku na vypnutém.
 *
 * Rozměry jsou taky z návrhu: 52 × 30 s kolečkem 22 a vnitřním okrajem 3 px.
 * Dřív to bylo 44 × 24, tedy znatelně drobnější, než jak přepínač vypadá
 * vedle formulářových polí kolem sebe.
 *
 * STAV SE NESDĚLUJE JEN BARVOU. Kolečko se posune, takže je rozlišovacím
 * znakem i poloha, a `role="switch"` s `aria-checked` nese stav pro čtečku.
 */
export const Switch = forwardRef<
  ElementRef<typeof RadixSwitch.Root>,
  ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <RadixSwitch.Root
      {...props}
      ref={ref}
      className={cn(
        'relative flex shrink-0 items-center rounded-full border border-border-strong p-[3px]',
        'h-[var(--size-switch-height)] w-[var(--size-switch-width)]',
        'transition-colors duration-[var(--duration-fast)]',
        'bg-surface-muted data-[state=checked]:bg-primary',
        className,
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          'block size-[var(--size-switch-knob)] rounded-full bg-field',
          'transition-transform duration-[var(--duration-normal)]',
          'data-[state=checked]:translate-x-[var(--size-switch-knob)]',
        )}
      />
    </RadixSwitch.Root>
  );
});
