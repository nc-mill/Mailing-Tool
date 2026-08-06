'use client';

import { cn } from '@mlain/ui/lib/cn';

/**
 * Přepínač období pro obrazovky Statistik.
 *
 * ZÁMĚRNĚ NENÍ PRVKEM KATALOGU (kapitola 4 základu designu): je to `role="group"`
 * s jedním rámečkem dokola a uvnitř tlačítka bez vlastního rámečku, oddělená
 * svislou linkou. Přehled má svůj vlastní ve `dashboard/range-switch.tsx`
 * s pevnými hodnotami 7/30/90; tenhle bere hodnoty jako čísla, protože Web
 * měří 24 hodin, 7 a 30 dní. Až se ukáže, že je stejný na třech místech,
 * je to kandidát na komponentu v `packages/ui`.
 *
 * Zvolené období nese `aria-pressed`, takže se stav nesděluje jen tmavou
 * plochou. Skupina neořezává přetečení (`overflow-hidden`), jinak by ukrojila
 * obrys zaostřeného tlačítka, který se kreslí 2 px vně; krajní tlačítka si
 * proto rohy zaoblují sama.
 */
export function PeriodSwitch<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-[var(--radius-control)] border border-border"
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-[var(--size-control-sm)] px-[var(--spacing-stack)] py-[var(--spacing-hairline)]',
            'font-mono text-meta transition-colors duration-[var(--duration-fast)]',
            'first:rounded-l-[var(--radius-control)] last:rounded-r-[var(--radius-control)]',
            // Barva obrysu je utilita z tokenu. Zápis `outline-[var(--color-focus-ring)]`
            // by vyrobil ŠÍŘKU obrysu, ne jeho barvu.
            'focus-visible:focus-ring',
            index > 0 ? 'border-l border-border' : '',
            value === option.value
              ? 'bg-panel text-panel-foreground'
              : 'bg-surface text-text-muted hover:bg-surface-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
