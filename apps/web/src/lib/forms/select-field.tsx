'use client';

import { useState } from 'react';
import { Label } from '@mlain/ui/components/label';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { FieldError, fieldErrorId } from '@/lib/forms/field-error';
import type { FieldErrors } from '@/lib/errors/field-errors';

export type SelectFieldOption = { value: string; label: string };

export type SelectFieldProps = {
  /** Jméno pole ve `FormData`. Nese ho skryté pole, ne komponenta z P05. */
  name: string;
  label: string;
  options: readonly SelectFieldOption[];
  defaultValue?: string;
  /** Text v prázdném stavu. `Select` ho má povinný. */
  placeholder: string;
  hint?: string;
  errors?: FieldErrors;
  /** Zavolá se po volbě, například když se má formulář odeslat hned. */
  onSelected?: (value: string) => void;
};

/**
 * Pole s výběrem pro formuláře odesílané Server Action.
 *
 * Skryté pole není berlička: `Select` z P05 stojí na Radixu a ten do formuláře
 * nic nevkládá, protože mu obálka `name` nepředává. Bez skrytého pole by se
 * hodnota nikam nedostala a **nic by nespadlo**, jen by se uložilo prázdno.
 *
 * Přístupné jméno nese `aria-label` na spouštěči, takže `getByLabelText`
 * i `getByRole('combobox', { name })` míří na tentýž prvek. Viditelný popisek
 * proto **není `<label>`**: `htmlFor` by ukazoval na skryté pole, které nejde
 * zaostřit, a `<label>` bez `htmlFor` obalující spouštěč by čtečce ohlásil
 * jméno dvakrát.
 */
export function SelectField({
  name,
  label,
  options,
  defaultValue,
  placeholder,
  hint,
  errors,
  onSelected,
}: SelectFieldProps) {
  const [value, setValue] = useState(defaultValue ?? '');
  const invalid = (errors?.[name]?.length ?? 0) > 0;

  return (
    <div data-select-field={name}>
      {/* Popisek se kreslí systémovou komponentou, ne opsanými třídami.
          Dřív tu bylo `text-sm font-medium` proti systémovému `font-semibold`
          a ve formuláři pak mělo jedno pole popisek jinak tučný než sousední.
          `aria-hidden` proto, že jméno nese `aria-label` spouštěče; bez toho
          by ho čtečka přečetla dvakrát. */}
      <Label as="span" aria-hidden className="mb-1">
        {label}
      </Label>
      <input type="hidden" name={name} value={value} readOnly />
      <Select
        {...(value === '' ? {} : { value })}
        onValueChange={(next) => {
          setValue(next);
          onSelected?.(next);
        }}
        placeholder={placeholder}
        aria-label={label}
        {...(invalid ? { 'aria-invalid': true, 'aria-describedby': fieldErrorId(name) } : {})}
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </Select>
      {hint ? <p className="mt-1 text-meta text-text-muted">{hint}</p> : null}
      {errors ? <FieldError name={name} errors={errors} /> : null}
    </div>
  );
}
