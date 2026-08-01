import { cn } from '../lib/cn';

/**
 * Určitý průběh. `valueText` je povinný, protože čtečka má číst
 * „3 214 z 12 480", ne „26 procent" (mapování 5.10).
 */
export function Progress({
  value,
  max,
  valueText,
  label,
  className,
}: {
  value: number;
  max: number;
  valueText: string;
  label: string;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-muted', className)}
    >
      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Neurčitý průběh: bez `aria-valuenow`, oblast dostane `aria-busy`. */
export function IndeterminateProgress({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-muted', className)}
    >
      <div className="h-full w-1/3 animate-pulse bg-primary" />
    </div>
  );
}
