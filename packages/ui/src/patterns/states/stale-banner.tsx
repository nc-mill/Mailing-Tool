import { cn } from '../../lib/cn';

/**
 * Stav S7. Data zůstanou, ztlumí se a nad nimi je, jak jsou stará.
 * Zobrazovat čerstvě vypadající zastaralé číslo je horší než přiznat stáří.
 */
export function StaleBanner({
  lastUpdatedLabel,
  retryAction,
  className,
}: {
  lastUpdatedLabel: string;
  retryAction: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="stale-banner"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)]',
        'border border-warning bg-warning-surface px-4 py-3 text-sm text-warning-text',
        className,
      )}
    >
      <span>{lastUpdatedLabel}</span>
      {retryAction}
    </div>
  );
}

/** Obal nad zastaralým obsahem: ztlumí ho, ale nechá čitelný a použitelný. */
export function StaleContent({ children }: { children: React.ReactNode }) {
  return <div className="opacity-60">{children}</div>;
}
