'use client';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

export type EmptyStateVariant = 'first' | 'filtered' | 'emptied';

export type EmptyStateAction = { label: string; onClick: () => void; description?: string };

/**
 * Prázdný stav je nejnavštěvovanější obrazovka nového uživatele.
 * Struktura je normativní (7.1, řádek S1): vysvětlení konceptu,
 * primární akce, sekundární cesta. Konkrétní znění vlastní katalogy.
 */
export function EmptyState({
  variant,
  title,
  explanation,
  actions,
  filterDescription,
  hint,
  secondary,
  className,
}: {
  variant: EmptyStateVariant;
  title: string;
  explanation: string;
  actions: EmptyStateAction[];
  /** Povinné u varianty `filtered`: připomenutí použitého filtru slovy. */
  filterDescription?: string | undefined;
  hint?: string | undefined;
  secondary?: React.ReactNode;
  className?: string | undefined;
}) {
  if (actions.length === 0) {
    throw new Error('Prázdný stav musí nabídnout aspoň jednu akci (kritérium 20).');
  }

  return (
    <section
      data-testid="empty-state"
      data-variant={variant}
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-4 rounded-[var(--radius-surface)]',
        'border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p data-testid="empty-explanation" className="text-sm text-text-muted">
        {explanation}
      </p>
      {filterDescription ? <p className="text-sm text-text">{filterDescription}</p> : null}
      <div className="flex flex-wrap justify-center gap-3">
        {actions.map((action, index) => (
          <div key={action.label} className="flex flex-col items-center">
            <Button variant={index === 0 ? 'primary' : 'secondary'} onClick={action.onClick}>
              {action.label}
            </Button>
            {action.description ? (
              <span className="mt-1 text-sm text-text-muted">{action.description}</span>
            ) : null}
          </div>
        ))}
      </div>
      {secondary}
      {hint ? <p className="text-sm italic text-text-muted">{hint}</p> : null}
    </section>
  );
}
