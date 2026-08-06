'use client';

import { useId } from 'react';
import { Card, CardFooter } from '@mlain/ui/components/card';
import { cn } from '@mlain/ui/lib/cn';

/**
 * Dlaždice s číslem. NENÍ to komponenta design systému a nemá jí být.
 *
 * Každá obrazovka ji má jinak (jedna nese deltu, druhá slovo za číslem, třetí
 * místo čísla větu „zatím nevíme"), takže sdílený prvek s osmi nepovinnými
 * propy by byl horší než složení z `Card` na místě. Tenhle soubor je proto
 * lokální dlaždice PŘEHLEDU, ne katalogový prvek: leží ve složce obrazovky
 * a nikdo jiný ji neimportuje.
 *
 * Zvýrazněná dlaždice (`tone="highlight"`) je na obrazovce jedna jediná: to
 * číslo, kterému věříme. Její patička musí mít linku ve žluté, jinak by hairline
 * rámeček karty a linka patičky byly dvě různé barvy na jedné kartě.
 */
export function StatTile({
  label,
  tone = 'plain',
  icon,
  iconTone,
  footer,
  children,
}: {
  label: string;
  tone?: 'plain' | 'highlight';
  /** Ikona ve 18 px (`icon-md`). Sama nic nesděluje, popisek je vedle ní. */
  icon: React.ReactNode;
  /** Plocha a barva čtverce s ikonou. Liší se podle významu dlaždice. */
  iconTone: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const labelId = useId();
  const highlight = tone === 'highlight';

  return (
    <Card
      padding="md"
      aria-labelledby={labelId}
      {...(highlight ? { tone: 'highlight' as const } : {})}
    >
      <div className="flex items-center justify-between gap-[var(--spacing-inline)]">
        {/*
          Popisek dlaždice je NADPIS, ne jen text v mono verzálkách. Podle něj
          se orientuje odečítač obrazovky i test zlaté cesty
          (`getByRole('heading', { name: 'Kliklo' })`).
        */}
        <h2
          id={labelId}
          className={cn('meta-caps', highlight ? 'text-warning-text' : 'text-text-muted')}
        >
          {label}
        </h2>
        <span
          aria-hidden
          className={cn(
            'inline-flex size-[var(--size-control-sm)] shrink-0 items-center justify-center',
            'rounded-[var(--radius-control)]',
            iconTone,
          )}
        >
          {icon}
        </span>
      </div>

      {children}

      {footer ? (
        <CardFooter className={highlight ? 'border-primary-hover' : ''}>{footer}</CardFooter>
      ) : null}
    </Card>
  );
}

/** Velké číslo dlaždice. Za ním smí stát slovo, které se s ním zarovná na účaří. */
export function StatValue({
  children,
  unit,
  className,
}: {
  children: React.ReactNode;
  /** Slovo za číslem, například „prokliky". Menší a bez tučnosti. */
  unit?: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-baseline gap-2 text-display font-semibold',
        'leading-[var(--leading-number)] tracking-[var(--tracking-number)] text-text',
        className,
      )}
    >
      {children}
      {unit ? <span className="text-ui font-normal text-text-muted">{unit}</span> : null}
    </p>
  );
}

/**
 * Změna proti minulému období. Zelená nahoru, červená dolů.
 *
 * BARVA NENÍ JEDINÝ ROZLIŠOVACÍ ZNAK: znaménko je součástí textu, takže se
 * směr pozná i bez rozlišení barev. Když se není s čím porovnat, řádek se
 * nevykreslí vůbec; nula by tvrdila, že se nic nezměnilo.
 */
export function StatDelta({
  value,
  label,
  format,
  muted,
}: {
  value: number;
  label: string;
  format: (value: number) => string;
  /** Popisek na zvýrazněné dlaždici je tmavší žlutá, ne šedá. */
  muted: string;
}) {
  return (
    <div className="flex items-center gap-[var(--spacing-inline)]">
      <span
        className={cn(
          'font-mono text-meta whitespace-nowrap',
          value >= 0 ? 'text-success-text' : 'text-danger-text',
        )}
      >
        {/* Znaménko mínus si dodá formátovač čísla sám, plus musí dopsat kód. */}
        {value > 0 ? '+' : ''}
        {format(value)}
      </span>
      <span className={cn('text-meta', muted)}>{label}</span>
    </div>
  );
}
