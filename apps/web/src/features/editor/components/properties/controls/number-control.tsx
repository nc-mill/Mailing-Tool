'use client';

import { Input } from '@mlain/ui/components/input';
import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

export function NumberControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'number') return <></>;
  const isNull = value === null || value === descriptor.nullValue;
  const clamp = (raw: number) => Math.min(descriptor.max, Math.max(descriptor.min, raw));

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        id={id}
        type="number"
        // Bez `min-w-0` si pole v pružném řádku drží vlastní vnitřní šířku
        // a vytlačí jednotku i přepínač mimo panel.
        className="min-w-0"
        data-autofocus={autoFocus ? '' : undefined}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        value={isNull ? '' : Number(value)}
        placeholder={isNull ? t('value.inherited') : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange(descriptor.nullValue ?? null);
            return;
          }
          onChange(clamp(Number(raw)));
        }}
      />
      <span aria-hidden className="text-meta text-text-muted">
        {descriptor.unit}
      </span>
      {descriptor.nullable ? (
        <Switch
          aria-label={t('value.useDefault')}
          checked={isNull}
          onCheckedChange={(checked) =>
            onChange(checked ? (descriptor.nullValue ?? null) : descriptor.min)
          }
        />
      ) : null}
    </div>
  );
}
