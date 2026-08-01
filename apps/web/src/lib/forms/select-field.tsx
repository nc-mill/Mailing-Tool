'use client';

import { useEffect, useRef, useState } from 'react';
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const invalid = (errors?.[name]?.length ?? 0) > 0;

  /**
   * ODCHYLKA OD PLÁNU, vynucená rozhraním P05: `Select` z `@mlain/ui` přijímá
   * jen `value`, `onValueChange`, `placeholder`, `className` a `aria-label`
   * a zbylé propy nepředává, takže `aria-invalid` ani `aria-describedby` se
   * na spouštěč nedostanou propem. Pravidlo 11.3 části 6 přitom žádá, aby
   * chybné pole bylo označené a svázané s textem chyby. Atributy se proto
   * dopisují na spouštěč po vykreslení. Do `packages/ui` P06 nesmí zapsat
   * (kapitola 0.2), takže je to zároveň zapsaný požadavek na P05: `Select`
   * má `aria-invalid` a `aria-describedby` umět propem.
   */
  useEffect(() => {
    const trigger = wrapperRef.current?.querySelector('[role="combobox"]');
    if (!trigger) return;
    if (invalid) {
      trigger.setAttribute('aria-invalid', 'true');
      trigger.setAttribute('aria-describedby', fieldErrorId(name));
    } else {
      trigger.removeAttribute('aria-invalid');
      trigger.removeAttribute('aria-describedby');
    }
  }, [invalid, name]);

  return (
    <div ref={wrapperRef} data-select-field={name}>
      <span aria-hidden className="mb-1 block text-sm font-medium text-text">
        {label}
      </span>
      <input type="hidden" name={name} value={value} readOnly />
      <Select
        {...(value === '' ? {} : { value })}
        onValueChange={(next) => {
          setValue(next);
          onSelected?.(next);
        }}
        placeholder={placeholder}
        aria-label={label}
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </Select>
      {hint ? <p className="mt-1 text-sm text-text-muted">{hint}</p> : null}
      {errors ? <FieldError name={name} errors={errors} /> : null}
    </div>
  );
}
