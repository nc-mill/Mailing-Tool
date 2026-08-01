import { cn } from '../../lib/cn';

/** Stav S14: co chybí, proč to je potřeba, tlačítko. Nikdy jen zašedlá obrazovka. */
export function PrerequisiteState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="prerequisite-state"
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-3 rounded-[var(--radius-surface)]',
        'border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="text-sm text-text-muted">{body}</p>
      <div>{action}</div>
    </section>
  );
}
