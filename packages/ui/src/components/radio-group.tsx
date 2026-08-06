'use client';

import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../lib/cn';

export const RadioGroup = forwardRef<
  ElementRef<typeof RadixRadioGroup.Root>,
  ComponentPropsWithoutRef<typeof RadixRadioGroup.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return (
    <RadixRadioGroup.Root {...props} ref={ref} className={cn('flex flex-col gap-2', className)} />
  );
});

export const RadioGroupItem = forwardRef<
  ElementRef<typeof RadixRadioGroup.Item>,
  ComponentPropsWithoutRef<typeof RadixRadioGroup.Item>
>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadixRadioGroup.Item
      {...props}
      ref={ref}
      className={cn(
        'grid size-[var(--size-choice)] shrink-0 place-items-center rounded-full border border-border-strong bg-field',
        'data-[state=checked]:border-edge data-[state=checked]:bg-panel',
        className,
      )}
    >
      <RadixRadioGroup.Indicator className="block size-1.5 rounded-full bg-panel-foreground" />
    </RadixRadioGroup.Item>
  );
});
