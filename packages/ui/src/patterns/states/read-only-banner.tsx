import { Eye } from '../../icons';
import { cn } from '../../lib/cn';

/**
 * Stav S12. Formuláře se v režimu jen pro čtení zobrazují **jako text**,
 * ne jako zašedlá pole. Nahoře je pruh s důvodem.
 */
export function ReadOnlyBanner({ reason, className }: { reason: string; className?: string }) {
  return (
    <div
      data-testid="read-only-banner"
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius-control)] border border-border',
        'bg-surface-muted px-4 py-3 text-sm text-text',
        className,
      )}
    >
      <Eye aria-hidden className="icon-sm text-text-muted" />
      {reason}
    </div>
  );
}

/** Hodnota formuláře v režimu jen pro čtení. Text, ne vstupní pole. */
export function ReadOnlyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text">{label}</span>
      <span className="text-sm text-text-muted">{value}</span>
    </div>
  );
}
