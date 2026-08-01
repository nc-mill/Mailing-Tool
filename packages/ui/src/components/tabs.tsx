'use client';

import { Tabs as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const Tabs = Radix.Root;

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Radix.List className={cn('flex gap-1 border-b border-border', className)}>
      {children}
    </Radix.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Radix.Trigger
      value={value}
      className="min-h-11 border-b-2 border-transparent px-4 text-sm text-text-muted data-[state=active]:border-primary data-[state=active]:text-text"
    >
      {children}
    </Radix.Trigger>
  );
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Radix.Content value={value} className="pt-4">
      {children}
    </Radix.Content>
  );
}
