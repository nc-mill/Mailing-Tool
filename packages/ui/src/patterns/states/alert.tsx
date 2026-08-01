import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export type AlertTone = 'info' | 'warning' | 'error' | 'success';

const TONE = {
  info: { border: 'border-border', surface: 'bg-surface-muted', text: 'text-text', Icon: Info },
  warning: {
    border: 'border-warning',
    surface: 'bg-warning-surface',
    text: 'text-warning-text',
    Icon: AlertTriangle,
  },
  error: {
    border: 'border-danger',
    surface: 'bg-danger-surface',
    text: 'text-danger-text',
    Icon: XCircle,
  },
  success: {
    border: 'border-success',
    surface: 'bg-success-surface',
    text: 'text-success-text',
    Icon: CheckCircle2,
  },
} as const;

/**
 * Obecný informační blok. Nese `title`, obsah, nebo obojí.
 *
 * Tón nikdy nenese informaci sám: ke každému patří ikona, aby text zůstal
 * srozumitelný v odstínech šedi a pro barvoslepé (pravidlo 11.3, barva není
 * jediný rozlišovací znak). Chybový a varovný tón se ohlašuje čtečce.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
  ...rest
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { border, surface, text, Icon } = TONE[tone];

  return (
    <div
      // Chybu a varování musí čtečka ohlásit, informaci a úspěch ne.
      role={tone === 'error' || tone === 'warning' ? 'alert' : undefined}
      data-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-sm',
        border,
        surface,
        text,
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
        {action}
      </div>
    </div>
  );
}
