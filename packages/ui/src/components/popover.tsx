'use client';

import { Popover as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const Popover = Radix.Root;
export const PopoverTrigger = Radix.Trigger;

export function PopoverContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Radix.Portal>
      <Radix.Content
        sideOffset={6}
        className={cn(
          'z-[var(--z-dialog)] rounded-[var(--radius-surface)] border border-border',
          'bg-surface-overlay p-4 text-sm text-text shadow-lg',
          className,
        )}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}
