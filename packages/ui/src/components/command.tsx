'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { cn } from '../lib/cn';

/**
 * Obal nad `cmdk`. API knihovny ven z tohohle souboru neuniká, protože
 * `cmdk` má poslední vydání starší než rok a platí pro něj pravidlo
 * vlastního rozhraní z 13.2 části 6.
 */
export const Command: typeof CommandPrimitive = CommandPrimitive;

export function CommandInput({ placeholder }: { placeholder: string }) {
  return (
    <CommandPrimitive.Input
      placeholder={placeholder}
      className="min-h-11 w-full border-b border-border bg-transparent px-4 text-sm text-text outline-none placeholder:text-text-muted"
    />
  );
}

export function CommandList({ children }: { children: React.ReactNode }) {
  return (
    <CommandPrimitive.List className="max-h-80 overflow-auto p-2">{children}</CommandPrimitive.List>
  );
}

export function CommandEmpty({ children }: { children: React.ReactNode }) {
  return (
    <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-text-muted">
      {children}
    </CommandPrimitive.Empty>
  );
}

export function CommandGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className={cn(
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        '[&_[cmdk-group-heading]]:text-text-muted',
      )}
    >
      {children}
    </CommandPrimitive.Group>
  );
}

export function CommandItem({
  value,
  onSelect,
  children,
}: {
  value: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-text data-[selected=true]:bg-surface-muted"
    >
      {children}
    </CommandPrimitive.Item>
  );
}
