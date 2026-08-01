'use client';

import { Tooltip as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const TooltipProvider = Radix.Provider;

/**
 * Tooltip je doplněk, nikdy jediný nositel informace: obsah `content`
 * musí být dostupný i jinde (K7 má tabulku pod grafem).
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Radix.Root delayDuration={200}>
      <Radix.Trigger asChild>{children}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          sideOffset={6}
          className={cn(
            'z-[var(--z-dialog)] max-w-72 rounded-[var(--radius-control)] border border-border',
            'bg-surface-overlay px-3 py-2 text-sm text-text shadow-md',
            className,
          )}
        >
          {content}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
