import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  [
    'meta-caps inline-flex w-fit items-center gap-1.5 whitespace-nowrap',
    'rounded-[var(--radius-control)] px-2.5 py-[var(--spacing-badge-y)]',
  ],
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-text-muted',
        accent: 'bg-accent-surface text-warning-text',
        success: 'bg-success-surface text-success-text',
        warning: 'bg-accent-surface text-warning-text',
        danger: 'bg-danger-surface text-danger-text',
        /** Nejsilnější zdůraznění: tmavá plocha se žlutým textem. */
        strong: 'bg-panel text-primary',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

/**
 * Odznak stavu. Mono verzálky na barevné ploše, rádius jako u tlačítka.
 *
 * STAV SE NIKDY NESDĚLUJE JEN BARVOU (pravidlo 11.3 části 6). Rozlišovacím
 * znakem je **slovo**, které je v `children` povinné. Ikona je nepovinná
 * ozdoba navíc: v návrhu ji většina odznaků nemá, protože text v malých
 * verzálkách je čitelný sám o sobě a ikona vedle něj jen ubírá místo.
 *
 * `warning` a `accent` mají schválně stejné barvy. V papírové paletě je
 * „upozornění" a „zvýrazněno" tatáž žlutá plocha; jsou to dva názvy pro
 * jeden vzhled, aby volající nemusel řešit, který z nich je ten správný.
 */
export function Badge({
  tone,
  icon,
  children,
  className,
}: VariantProps<typeof badgeVariants> & {
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      {icon ? (
        <span aria-hidden className="flex items-center justify-center">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
