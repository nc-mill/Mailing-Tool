'use client';

import { Select as Radix } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

export function Select({
  value,
  onValueChange,
  placeholder,
  children,
  className,
  'aria-label': ariaLabel,
}: {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
  className?: string;
  'aria-label': string;
}) {
  return (
    <Radix.Root {...(value === undefined ? {} : { value })} onValueChange={onValueChange}>
      <Radix.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-control)]',
          'border border-border-strong bg-surface px-3 text-sm text-text',
          className,
        )}
      >
        <Radix.Value placeholder={placeholder} />
        <ChevronDown aria-hidden className="size-4 text-text-muted" />
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          position="popper"
          sideOffset={4}
          className="z-[var(--z-dialog)] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-[var(--radius-surface)] border border-border bg-surface-overlay p-1 shadow-lg"
        >
          <Radix.Viewport>{children}</Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Radix.Item
      value={value}
      className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 text-sm text-text data-[highlighted]:bg-surface-muted"
    >
      <Radix.ItemText>{children}</Radix.ItemText>
      <Radix.ItemIndicator>
        <Check aria-hidden className="size-4" />
      </Radix.ItemIndicator>
    </Radix.Item>
  );
}
