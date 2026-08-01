'use client';

import { Checkbox as RadixCheckbox } from 'radix-ui';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../lib/cn';

export const Checkbox = forwardRef<
  ElementRef<typeof RadixCheckbox.Root>,
  ComponentPropsWithoutRef<typeof RadixCheckbox.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <RadixCheckbox.Root
      {...props}
      ref={ref}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-[4px]',
        'border border-border-strong bg-surface',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
    >
      <RadixCheckbox.Indicator className="text-primary-foreground">
        <Check aria-hidden className="size-4" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
});
