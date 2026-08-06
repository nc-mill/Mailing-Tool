'use client';

import { Select as Radix } from 'radix-ui';
import { Check, ChevronDown } from '../icons';
import { cn } from '../lib/cn';

type SelectBase = {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
  className?: string;
  /** Doplní `Field`, když je výběr uvnitř něj. */
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
};

/**
 * Výběr musí mít jméno, ale typ ho vynutit nedokáže.
 *
 * Zkusil jsem to sjednocením dvou tvarů („buď `id`, nebo `aria-label`") a je
 * to slepá ulička: `Field` dosazuje `id` potomkovi až za běhu přes
 * `cloneElement`, takže překladač u výběru uvnitř `Field` žádné `id` nevidí
 * a hlásí chybu na správně napsaném kódu. Vynucovat pravidlo tak, že
 * u poloviny správných použití svítí červená, je horší než nevynucovat.
 *
 * Platí tedy totéž co u `Input`: **pole patří do `Field`**, který popisek
 * i vazbu dodá. Mimo `Field` (filtr v liště, výběr v řádku tabulky) se dá
 * `aria-label`. Propojení hlídá test `field.test.tsx`.
 */
type SelectProps = SelectBase & {
  /** Doplní `Field`. Mimo něj se místo toho dává `aria-label`. */
  id?: string;
  'aria-label'?: string;
};

/**
 * Rozbalovací výběr.
 *
 * PROČ BERE `id`: `Field` propojuje popisek s prvkem tak, že potomkovi dosadí
 * `id` a k němu napíše `<label for>`. Výběr `id` dřív nepřijímal, takže se
 * do `Field` vložit nedal a obrazovky si popisek kreslily samy jako
 * `<span aria-hidden>` vedle `aria-label`. Byly to dva popisky na totéž,
 * které se mohly rozejít, a v aplikaci jich mají být desítky.
 */
export function Select({
  value,
  onValueChange,
  placeholder,
  children,
  className,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: SelectProps) {
  return (
    <Radix.Root {...(value === undefined ? {} : { value })} onValueChange={onValueChange}>
      <Radix.Trigger
        {...(id === undefined ? {} : { id })}
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        {...(invalid === undefined ? {} : { 'aria-invalid': invalid })}
        className={cn(
          'flex min-h-[var(--size-target-min)] w-full items-center justify-between gap-2 rounded-[var(--radius-control)]',
          'border border-border-strong bg-field px-3.5 py-2.5 text-ui text-text',
          className,
        )}
      >
        <Radix.Value placeholder={placeholder} />
        <ChevronDown aria-hidden className="icon-sm text-text-muted" />
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          position="popper"
          sideOffset={4}
          className="z-[var(--z-dialog)] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-[var(--radius-surface)] border border-border bg-surface-overlay p-1"
        >
          <Radix.Viewport>{children}</Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Radix.Item
      value={value}
      className="flex min-h-[var(--size-target-min)] cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 text-ui text-text data-[highlighted]:bg-surface-muted"
    >
      <Radix.ItemText>{children}</Radix.ItemText>
      <Radix.ItemIndicator>
        <Check aria-hidden className="icon-sm" />
      </Radix.ItemIndicator>
    </Radix.Item>
  );
}
