import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const cardVariants = cva('flex min-w-0 flex-col rounded-[var(--radius-surface)] border', {
  variants: {
    tone: {
      /** Běžná karta: papír a hairline rámeček. */
      plain: 'border-border bg-surface',
      /** Klidnější plocha, například vysvětlivka nad obsahem. */
      muted: 'border-border bg-surface-muted',
      /** Zvýrazněná karta: to jediné číslo, kterému na stránce věříme. */
      highlight: 'border-primary-hover bg-accent-surface',
      /** Tmavý panel, například pruh hromadného výběru. */
      panel: 'on-panel border-transparent bg-panel text-panel-foreground',
    },
    padding: {
      /** 30 px: graf, formulářová sekce, seznam. */
      lg: 'p-[var(--spacing-card)]',
      /** 25 px: dlaždice s číslem. */
      md: 'p-[var(--spacing-card-tight)]',
      /** 20 px: hláška, úzký pruh. */
      sm: 'p-[var(--spacing-gutter)]',
      /** Bez okraje: karta, ve které sedí tabulka až k rámečku. */
      none: 'p-0',
    },
    gap: {
      stack: 'gap-[var(--spacing-stack)]',
      gutter: 'gap-[var(--spacing-gutter)]',
      none: 'gap-0',
    },
  },
  defaultVariants: { tone: 'plain', padding: 'lg', gap: 'stack' },
});

/**
 * Karta. Jediný způsob, jak se v aplikaci ohraničuje obsah.
 *
 * ŽÁDNÝ STÍN, ŽÁDNÝ GRADIENT. Karta se od pozadí odděluje **hairline
 * rámečkem** o tloušťce 1 px. Je to výslovné pravidlo návrhu, ne zapomenutí:
 * stránka je plocha papíru a karty jsou na ní narýsované, ne položené.
 *
 * Rádius je 10 px (`--radius-surface`), na rozdíl od tlačítek a polí, která
 * mají 4 px. Dvě hodnoty, žádná třetí.
 *
 * Nadpis karty se píše jako `CardTitle`, aby měl na všech obrazovkách stejnou
 * velikost i stejné odsazení.
 */
export function Card({
  tone,
  padding,
  gap,
  as: Element = 'section',
  className,
  children,
  ...rest
}: VariantProps<typeof cardVariants> & {
  /**
   * Značka, kterou karta vykreslí.
   *
   * `section` u obsahu s nadpisem, `div` u pruhu bez nadpisu, `article`
   * u samostatně srozumitelné položky. **`li` je tu proto, aby šlo udělat
   * seznam karet jako skutečný seznam**: bez něj si obrazovky pomáhaly
   * `role="list"` a `role="listitem"`, což čtečce říká totéž, ale je to
   * obcházení sémantiky. Karta s `as="li"` patří do `<ul>`.
   */
  as?: 'section' | 'div' | 'article' | 'aside' | 'li';
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<'section'>, 'children'>) {
  return (
    <Element {...rest} className={cn(cardVariants({ tone, padding, gap }), className)}>
      {children}
    </Element>
  );
}

/**
 * Hlavička karty: nadpis vlevo, meta údaj vedle něj, odkaz vpravo.
 * Zarovnává se na účaří, aby menší meta text seděl na stejné lince
 * jako nadpis a ne na jeho střed.
 */
export function CardHeader({
  title,
  meta,
  action,
  className,
}: {
  title: React.ReactNode;
  /** Drobný údaj vedle nadpisu, například „za posledních 7 dní". */
  meta?: React.ReactNode;
  /** Odkaz nebo tlačítko vpravo. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline gap-[var(--spacing-stack)]', className)}>
      <CardTitle>{title}</CardTitle>
      {meta ? <span className="font-mono text-meta text-text-muted">{meta}</span> : null}
      {action ? <span className="ml-auto text-ui">{action}</span> : null}
    </div>
  );
}

/** Nadpis karty. Vždycky 19 px, polotučně, s mírně staženým prostrkáním. */
export function CardTitle({
  as: Element = 'h2',
  className,
  children,
}: {
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Element
      className={cn(
        'text-h3 font-semibold tracking-[var(--tracking-heading)] text-text',
        className,
      )}
    >
      {children}
    </Element>
  );
}

/**
 * Patička karty. Odsazená linkou nahoře a přitlačená ke dnu karty, aby
 * několik karet vedle sebe mělo patičku na stejné výšce i při různě
 * dlouhém obsahu.
 */
export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-auto flex items-center gap-[var(--spacing-inline)]',
        'border-t border-border pt-[var(--spacing-stack)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
