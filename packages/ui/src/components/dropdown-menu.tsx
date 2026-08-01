'use client';

import { DropdownMenu as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const DropdownMenu = Radix.Root;
export const DropdownMenuTrigger = Radix.Trigger;

export function DropdownMenuContent({
  children,
  align = 'start',
  className,
}: {
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <Radix.Portal>
      <Radix.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-[var(--z-dialog)] min-w-56 rounded-[var(--radius-surface)] border border-border',
          'bg-surface-overlay p-1 text-sm text-text shadow-lg',
          className,
        )}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <Radix.Item
      onSelect={() => onSelect?.()}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-3',
        'data-[highlighted]:bg-surface-muted',
        tone === 'danger' ? 'text-danger-text' : 'text-text',
      )}
    >
      {children}
    </Radix.Item>
  );
}

export function DropdownMenuSeparator() {
  return <Radix.Separator className="my-1 h-px bg-border" />;
}
