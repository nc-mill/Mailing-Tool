'use client';

import { Dialog as RadixDialog } from 'radix-ui';
import { createContext, useContext, useRef } from 'react';
import { cn } from '../lib/cn';

const RetreatContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

export function Dialog({
  open,
  onOpenChange,
  children,
  /** Destruktivní dialog nejde zavřít kliknutím mimo (pravidlo 5.3). Esc funguje vždy. */
  destructive = false,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  destructive?: boolean;
  className?: string;
}) {
  const retreatRef = useRef<HTMLDivElement | null>(null);
  // Dialog se otevírá z libovolného tlačítka mimo Radix Trigger, takže si
  // spouštěč musíme zapamatovat sami. Bez toho by fokus po zavření spadl na body.
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-dialog)] bg-[var(--color-scrim)]" />
        <RadixDialog.Content
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            openerRef.current = document.activeElement as HTMLElement | null;
            // Výchozí fokus patří tlačítku ústupu. Enter bez čtení pak nic nesmaže.
            const retreat = retreatRef.current?.querySelector<HTMLElement>('button, [href]');
            if (retreat) {
              event.preventDefault();
              retreat.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            // Fokus se vrací na prvek, ze kterého se dialog otevřel (pravidlo 5.3).
            const opener = openerRef.current;
            openerRef.current = null;
            if (opener?.isConnected) {
              event.preventDefault();
              opener.focus();
            }
          }}
          onPointerDownOutside={(event) => {
            if (destructive) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (destructive) event.preventDefault();
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-[var(--z-dialog)] w-[min(32rem,calc(100vw-2rem))]',
            '-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-surface)]',
            'border border-border bg-surface-overlay p-6 text-text shadow-lg',
            className,
          )}
        >
          <RetreatContext.Provider value={retreatRef}>{children}</RetreatContext.Provider>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Nadpis nese informaci, nikdy slovo „Potvrzení" (9.4). */
export function DialogTitle({ children }: { children: React.ReactNode }) {
  return (
    <RadixDialog.Title className="text-lg font-semibold text-text">{children}</RadixDialog.Title>
  );
}

export function DialogBody({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-col gap-3 text-sm text-text">{children}</div>;
}

/**
 * Pozice tlačítek je v celé aplikaci stejná: vlevo ústup, vpravo potvrzení (6.7).
 * Proto se předávají jmenovitě, ne jako volné `children`.
 */
export function DialogFooter({
  retreat,
  confirm,
}: {
  retreat: React.ReactNode;
  confirm: React.ReactNode;
}) {
  const retreatRef = useContext(RetreatContext);
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <div ref={retreatRef}>{retreat}</div>
      <div>{confirm}</div>
    </div>
  );
}
