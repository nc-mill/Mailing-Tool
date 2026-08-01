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
        'size-5 rounded-full border border-border-strong bg-surface',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
    >
      <RadixRadioGroup.Indicator className="block size-2 rounded-full bg-primary-foreground" />
    </RadixRadioGroup.Item>
  );
});
