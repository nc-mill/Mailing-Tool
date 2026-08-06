'use client';

import { Tooltip as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const TooltipProvider = Radix.Provider;

/**
 * Bublina s popisem.
 *
 * Tooltip je doplněk, nikdy jediný nositel informace: obsah `content`
 * musí být dostupný i jinde (K7 má tabulku pod grafem).
 *
 * VZHLED: tmavý panel, mono 12 px, rádius jako u tlačítka, **bez rámečku
 * a bez stínu**. Tmavá plocha na papírovém pozadí se od něj oddělí sama,
 * rámeček by na ní byl navíc a stín systém nemá. Barvy jsou z tokenů
 * `--color-panel*`, tedy stejné jako boční menu, takže bublina vypadá
 * v obou motivech stejně.
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
            'z-[var(--z-dialog)] max-w-72 rounded-[var(--radius-control)]',
            'bg-panel px-2.5 py-[var(--spacing-hairline)]',
            'font-mono text-label text-panel-foreground',
            className,
          )}
        >
          {content}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
