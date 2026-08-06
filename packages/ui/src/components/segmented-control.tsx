'use client';

import { cn } from '../lib/cn';

/**
 * Přepínač několika voleb v jednom rámečku, například období 7 / 30 / 90 dní.
 *
 * PROČ JE Z TOHO KOMPONENTA. V `DESIGN-ZAKLAD` stálo, že se píše na místě,
 * dokud ho nepotřebují tři obrazovky. Potřebují ho tři: Přehled, Vývoj v čase
 * a Web. Web navíc měří hodiny, ne dny, takže se lišily i hodnoty a každá
 * kopie by se rozešla jinam.
 *
 * ROZHRANÍ JE OBECNÉ V HODNOTĚ (`Value`), ne svázané s obdobím: obrazovka si
 * předá vlastní typ voleb a dostane ho zpátky. Hodnota smí být **řetězec
 * i číslo**, protože Přehled počítá období ve dnech jako čísla, kdežto Web
 * měří 24 hodin a rozlišuje je slovem. Popisky si skládá volající z katalogu,
 * komponenta žádný text nevymýšlí.
 *
 * SKUPINA NEOŘEZÁVÁ PŘETEČENÍ. `overflow-hidden` by sice zaoblilo rohy
 * zvolenému tlačítku, ale ukrojilo by obrys toho zaostřeného, který se kreslí
 * 2 px vně. Krajní tlačítka si proto rohy zaoblují sama.
 *
 * STAV SE NESDĚLUJE JEN BARVOU: zvolená volba nese `aria-pressed`, takže ho
 * čtečka ohlásí i bez tmavé plochy.
 */
export function SegmentedControl<Value extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Název skupiny pro čtečku, například „Období". */
  label: string;
  options: ReadonlyArray<{ value: Value; label: string }>;
  value: Value;
  onChange: (value: Value) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex rounded-[var(--radius-control)] border border-border', className)}
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
