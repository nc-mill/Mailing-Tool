'use client';

import { Collapsible as Radix } from 'radix-ui';
import { ChevronRight } from '../icons';
import { cn } from '../lib/cn';

export function Collapsible({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <Radix.Root defaultOpen={defaultOpen} className={cn('text-sm', className)}>
      <Radix.Trigger className="flex min-h-11 items-center gap-2 text-left text-text-muted">
        <ChevronRight
          aria-hidden
          className="icon-sm transition-transform data-[state=open]:rotate-90"
        />
        {summary}
      </Radix.Trigger>
      <Radix.Content className="pt-2">{children}</Radix.Content>
    </Radix.Root>
  );
}
