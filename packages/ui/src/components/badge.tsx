import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-text',
        accent: 'bg-accent-surface text-accent-text',
        success: 'bg-success-surface text-success-text',
        warning: 'bg-warning-surface text-warning-text',
        danger: 'bg-danger-surface text-danger-text',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

/**
 * Odznak nese barvu, ikonu i slovo. Stav se nikdy nesděluje jen barvou (11.3).
 * Ikona je proto povinná a `children` musí obsahovat text.
 */
export function Badge({
  tone,
  icon,
  children,
  className,
}: VariantProps<typeof badgeVariants> & {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      <span aria-hidden className="flex size-4 items-center justify-center">
        {icon}
      </span>
      {children}
    </span>
  );
}
