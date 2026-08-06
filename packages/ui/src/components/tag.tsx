import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const tagVariants = cva(
  [
    'inline-flex w-fit items-center gap-1 whitespace-nowrap uppercase',
    'rounded-[var(--radius-control)] px-2 py-0.5',
    'font-mono text-micro tracking-[var(--tracking-label)]',
  ],
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-text-muted',
        accent: 'bg-accent-surface text-warning-text',
        success: 'bg-success-surface text-success-text',
        danger: 'bg-danger-surface text-danger-text',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

/**
 * Štítek: nejmenší popiska v systému, 11 px.
 *
 * ROZDÍL PROTI `Badge`: odznak nese STAV položky („odesláno", „rozepsaná")
 * a stojí ve vlastním sloupci. Štítek nese doplněk k údaji vedle sebe,
 * například odkud se vzalo oslovení nebo který štítek má kontakt. Proto je
 * menší, tišší a smí jich být v jednom řádku několik.
 *
 * Když si nejsi jistý, který z těch dvou použít: ptá se stránka „v jakém je
 * to stavu?" → `Badge`. Ptá se „co ještě o tom víme?" → `Tag`.
 */
export function Tag({
  tone,
  icon,
  children,
  className,
}: VariantProps<typeof tagVariants> & {
  /**
   * Nepovinná ikona před textem. Kreslí se v `icon-2xs` (12 px), protože
   * štítek má písmo 11 px a šestnáctipixelová ikona vedle něj vypadá jako
   * ikona s poznámkou pod čarou. Mezeru drží `gap`, nedoplňuj ji ručně.
   */
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(tagVariants({ tone }), className)}>
      {icon ? (
        <span aria-hidden className="flex items-center justify-center">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
