import { cn } from '../../lib/cn';

/** Stav S15: aktuální hodnota, limit, co s tím a kdy se limit obnoví. */
export function OverLimitState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="over-limit-state"
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-surface)] border border-warning',
        'bg-warning-surface p-6 text-warning-text',
        className,
      )}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-text">{body}</p>
      {action}
    </section>
  );
}
