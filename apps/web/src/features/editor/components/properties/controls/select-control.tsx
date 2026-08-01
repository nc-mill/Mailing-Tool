'use client';

import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

export function SelectControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'select') return <></>;
  return (
    <select
      id={id}
      data-autofocus={autoFocus ? '' : undefined}
      className="h-9 w-full rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm"
      value={String(value ?? '')}
      onChange={(event) => {
        const raw = event.target.value;
        const option = descriptor.options.find((item) => String(item.value) === raw);
        onChange(option ? option.value : raw);
      }}
    >
      {descriptor.options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {t(option.label)}
        </option>
      ))}
    </select>
  );
}
