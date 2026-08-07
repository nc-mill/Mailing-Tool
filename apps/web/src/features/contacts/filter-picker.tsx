'use client';

import { useState } from 'react';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@mlain/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import { Check, ChevronDown } from '@mlain/ui/icons';

export type FilterOption = { id: string; name: string };

export type ContactFilterPickerProps = {
  /** Jméno filtru pro čtečku i pro nevybraný stav („Seznam", „Štítek"). */
  label: string;
  /** Volba, která filtr zruší („Všechny seznamy"). Stojí první v nabídce. */
  allLabel: string;
  searchPlaceholder: string;
  /** Věta, když hledanému výrazu neodpovídá žádná položka. */
  emptyText: string;
  options: FilterOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  icon: React.ReactNode;
  'data-testid'?: string;
};

/**
 * Výběr jedné hodnoty filtru z hledatelné nabídky.
 *
 * PROČ NE `Select`. V projektu mohou být desítky seznamů a stovky štítků. Rozbalovátko
 * bez hledání se u nich čte řádek po řádku a po čase se v něm hledaná položka nedá najít
 * jinak než rolováním. Aplikace už jeden hledatelný výběr má, a to paletku personalizace
 * v editoru (`Popover` + `Command`), takže se tady bere TÝŽ vzorec. Třetí způsob výběru
 * vedle `Select` a paletky by znamenal, že se táž věc ovládá na každé obrazovce jinak.
 *
 * JE TO JEDNA HODNOTA, NE VÍC. API bere `list_id` i `tag_id` jako jediné UUID
 * (`contacts.routes.ts`), takže vícenásobný výběr by rozhraní slíbilo něco, co endpoint
 * neunese. Na složené podmínky („Brno NEBO Praha") jsou v aplikaci segmenty.
 *
 * ZRUŠENÍ FILTRU JE POLOŽKA NABÍDKY, ne křížek vedle tlačítka. Křížek by na obrazovce
 * přibyl potřetí (pruh s filtrem nad tabulkou má „Zrušit všechny filtry", prázdný stav
 * má vlastní dvě zrušení) a v liště, kde stojí vedle sebe dva výběry, by se pletl s tím,
 * co ruší který.
 */
export function ContactFilterPicker({
  label,
  allLabel,
  searchPlaceholder,
  emptyText,
  options,
  value,
  onChange,
  icon,
  'data-testid': testId,
}: ContactFilterPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  // Vybraná položka, která v nabídce není (smazaný seznam, štítek nad rámec načtené
  // stránky), se pozná podle toho, že v `options` chybí. Tlačítko pak ukazuje jméno
  // filtru, ale zůstává v činném stavu, aby nelhalo o tom, že se nefiltruje.
  const active = value !== undefined;

  function pick(next: string | undefined) {
    setOpen(false);
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          /*
           * Jméno filtru I VYBRANÁ HODNOTA.
           *
           * `aria-label` přebíjí text uvnitř tlačítka, takže se samotným „Seznam" by
           * čtečka ohlásila „Seznam, tlačítko" a zvolený seznam by v ní zmizel, přestože
           * ho každý na obrazovce vidí. Vidoucí uživatel a čtečka musí dostat totéž.
           */
          aria-label={selected === undefined ? label : `${label}: ${selected.name}`}
          data-testid={testId}
          className={[
            'flex h-[var(--size-control)] items-center gap-[var(--spacing-inline)]',
            'rounded-[var(--radius-control)] border px-3.5 text-ui',
            'transition-colors duration-[var(--duration-fast)]',
            /*
             * VÝŠKA JE 40 PX, KLIKACÍ PLOCHA 44 PX.
             *
             * 40 px je `--size-control`, tedy „pole filtru" podle návrhu, a stojí
             * v jedné řadě s hledacím polem a přepínačem stavu, které tuhle výšku mají
             * od začátku. Nafouknout jen tenhle prvek na 44 px by řadu rozhodilo.
             * Plocha se proto roztahuje neviditelným překryvem, stejně jako u nabídky
             * „…" v řádku tabulky: ukazatel má 44 px podle pravidla, řádek si drží
             * rytmus návrhu.
             */
            'relative after:absolute after:top-1/2 after:left-0 after:h-[var(--size-target-min)]',
            "after:w-full after:-translate-y-1/2 after:content-['']",
            active
              ? 'border-border-strong bg-panel text-panel-foreground'
              : 'border-border-strong bg-field text-text-muted hover:text-text',
          ].join(' ')}
        >
          {icon}
          <span className="max-w-[14ch] truncate">{selected?.name ?? label}</span>
          <ChevronDown aria-hidden className="icon-sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {/* Volba „Všechny …" má vlastní hodnotu pro hledání, jinak by ji `cmdk`
                při psaní schovalo a zrušit filtr by šlo jedině vymazáním výrazu. */}
            <CommandItem value={allLabel} onSelect={() => pick(undefined)}>
              <span className="flex w-full items-center justify-between gap-3">
                {allLabel}
                {value === undefined ? <Check aria-hidden className="icon-sm" /> : null}
              </span>
            </CommandItem>
            {options.map((option) => (
              <CommandItem key={option.id} value={option.name} onSelect={() => pick(option.id)}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="truncate">{option.name}</span>
                  {option.id === value ? <Check aria-hidden className="icon-sm" /> : null}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
