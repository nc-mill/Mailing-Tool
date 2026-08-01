import { cn } from '../lib/cn';

/** Skeleton má tvar budoucího obsahu, ne obecný obdélník (14.4). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-[var(--radius-control)] bg-surface-muted', className)}
    />
  );
}
