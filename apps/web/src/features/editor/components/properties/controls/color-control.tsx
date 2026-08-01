'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

const ROLES = [
  'brand.primary',
  'brand.secondary',
  'brand.accent',
  'text.default',
  'text.muted',
  'text.inverted',
  'surface.canvas',
  'surface.content',
  'surface.subtle',
  'link.default',
];

export function ColorControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'color') return <></>;
  const isHex = typeof value === 'string' && value.startsWith('#');

  return (
    <div className="flex items-center gap-2">
      <select
        id={id}
        data-autofocus={autoFocus ? '' : undefined}
        className="h-9 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm"
        value={isHex ? '$custom' : String(value ?? '$none')}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '$none') onChange(null);
          else if (next === '$custom') onChange('#000000');
          else onChange(next);
        }}
      >
        {descriptor.nullable ? <option value="$none">{t('value.color.none')}</option> : null}
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {t(`value.color.${role}`)}
          </option>
        ))}
        <option value="$custom">{t('value.color.custom')}</option>
      </select>
      {isHex ? (
        <Input
          type="color"
          aria-label={t('value.color.custom')}
          value={String(value)}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          className="h-9 w-12 p-1"
        />
      ) : null}
    </div>
  );
}
