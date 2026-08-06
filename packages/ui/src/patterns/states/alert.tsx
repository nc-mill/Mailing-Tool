import { TriangleAlert, CircleCheck, Info, CircleX } from '../../icons';
import { cn } from '../../lib/cn';

export type AlertTone = 'info' | 'warning' | 'error' | 'success';

const TONE = {
  info: {
    border: 'border-l-border-strong',
    surface: 'bg-surface-muted',
    text: 'text-text',
    Icon: Info,
  },
  warning: {
    border: 'border-l-warning',
    surface: 'bg-warning-surface',
    text: 'text-warning-text',
    Icon: TriangleAlert,
  },
  error: {
    border: 'border-l-danger',
    surface: 'bg-danger-surface',
    text: 'text-danger-text',
    Icon: CircleX,
  },
  success: {
    border: 'border-l-success',
    surface: 'bg-success-surface',
    text: 'text-success-text',
    Icon: CircleCheck,
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
      // Hláška má vlevo SILNOU LINKU 3 px v barvě tónu a zbytek rámečku
      // hairline. V návrhu je to jediný prvek, který takhle vypadá, a je to
      // schválně: hláška se objeví nad obsahem a musí být poznat na první
      // pohled, ale nesmí kvůli tomu být barevná celá.
      className={cn(
        'flex items-start gap-[var(--spacing-stack)]',
        // `length:` je POVINNÉ. Bez něj je hranatá hodnota pro `tailwind-merge`
        // nejednoznačná, zařadí ji mezi BARVY levého rámečku a barva z tónu ji
        // o řádek níž tiše přebije. Linka pak vyšla 1 px místo tří na každé
        // hlášce v aplikaci. Táž past jako u velikostí písma, viz DESIGN-ZAKLAD.
        'rounded-[var(--radius-surface)] border border-border border-l-[length:var(--border-accent)]',
        'px-[var(--spacing-gutter)] py-[var(--spacing-gutter)] text-ui',
        border,
        surface,
        text,
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className="mt-0.5 icon-md shrink-0" />
      <div className="flex min-w-0 flex-col items-start gap-[var(--spacing-hairline)]">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
        {/* `items-start` na obalu, ne šířka na akci: tlačítko uvnitř svislého
            flexu se jinak roztáhne na celou šířku hlášky a „Vrátit zpět"
            vypadá jako pruh přes půl obrazovky. Vlastní obal navíc drží
            odsazení od textu i tehdy, když je akcí víc. */}
        {action ? (
          <div className="mt-1 flex flex-wrap gap-[var(--spacing-inline)]">{action}</div>
        ) : null}
      </div>
    </div>
  );
}
