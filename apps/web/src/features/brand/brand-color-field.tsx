'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import type { FieldErrors } from '@/lib/errors/field-errors';

export type BrandColorFieldProps = {
  /** Jméno pole ve `FormData`. Nese ho textové pole s hexem, ne výběr barvy. */
  name: string;
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  errors: FieldErrors;
  disabled?: boolean;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Jedna barva značky: vzorek, systémový výběr barvy a hex vedle sebe.
 *
 * Proč obojí, a ne jen `input[type=color]`: nativní výběr barvy je jediné
 * ovládání, kterým jde barvu opravdu VIDĚT a myší vybrat, ale nedá se do něj
 * vložit hodnota z brand manuálu. Naopak z hexu se nedá poznat, jak barva
 * vypadá. Dvojice pokrývá obojí a obě půlky drží tutéž hodnotu.
 *
 * Do formuláře jde TEXTOVÉ pole, ne výběr barvy. Nativní výběr posílá vždycky
 * `#rrggbb` malými písmeny, takže by sám o sobě stačil, jenže když uživatel
 * napíše do textu nesmysl, přepsal by ho výběrem tiše na černou. Takhle se
 * odešle přesně to, co je v textu, a server na tom může postavit hlášku.
 */
export function BrandColorField({
  name,
  label,
  hint,
  value,
  onChange,
  errors,
  disabled = false,
}: BrandColorFieldProps) {
  const t = useTranslations('ai');
  const textId = useId();
  const pickerId = useId();
  // Text si drží vlastní stav, aby se dalo psát „#2" bez toho, aby se každý
  // rozepsaný hex propsal do vzorku a ten blikal na černou.
  const [draft, setDraft] = useState(value);
  const valid = HEX.test(draft);
  const shown = valid ? draft.toLowerCase() : value;

  return (
    <div className="flex flex-wrap items-start gap-[var(--spacing-stack)]">
      <div className="min-w-40 flex-1">
        <Label htmlFor={textId}>{label}</Label>
        <p className="mt-0.5 text-meta text-text-muted">{hint}</p>
      </div>

      <div className="flex items-center gap-[var(--spacing-inline)]">
        {/*
          Vzorek je `span`, ne obrázek: barva je dekorace textu vedle, ne
          samostatná informace. Hodnota je hned vedle v hexu a ta se čte
          i čtečkou, takže se na barvě nic nezakládá.
        */}
        <span
          aria-hidden="true"
          data-testid={`brand-swatch-${name}`}
          className="inline-block size-[var(--size-control-sm)] shrink-0 rounded-[var(--radius-control)] border border-border-strong"
          style={{ backgroundColor: shown }}
        />
        {/*
          Přístupné jméno se LIŠÍ od popisku textového pole. Dvě ovládání téže
          hodnoty se stejným jménem znamenají, že čtečka ohlásí „Hlavní barva"
          dvakrát a uživatel nepozná, ve kterém z nich stojí.
        */}
        <Input
          id={pickerId}
          type="color"
          aria-label={t('brand.colorPicker', { label })}
          value={shown}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value.toLowerCase();
            setDraft(next);
            onChange(next);
          }}
          className="h-[var(--size-control-sm)] w-12 shrink-0 p-1"
        />
        <Input
          id={textId}
          name={name}
          value={draft}
          disabled={disabled}
          spellCheck={false}
          maxLength={7}
          className="w-28 font-mono"
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (HEX.test(next)) onChange(next.toLowerCase());
          }}
          {...fieldAria(name, errors)}
        />
      </div>
      <div className="w-full">
        <FieldError name={name} errors={errors} />
      </div>
    </div>
  );
}
