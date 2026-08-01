'use client';

import { Switch as RadixSwitch } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../lib/cn';

export const Switch = forwardRef<
  ElementRef<typeof RadixSwitch.Root>,
  ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <RadixSwitch.Root
      {...props}
      ref={ref}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border border-border-strong',
        'bg-surface-muted data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
    >
      <RadixSwitch.Thumb className="block size-4 translate-x-1 rounded-full bg-text transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-primary-foreground" />
    </RadixSwitch.Root>
  );
});
