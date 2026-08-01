'use client';

import { Switch } from '@mlain/ui/components/switch';
import type { ControlProps } from '../prop-field';

export function ToggleControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  if (descriptor.kind !== 'toggle') return <></>;
  return (
    <Switch
      id={id}
      data-autofocus={autoFocus ? '' : undefined}
      checked={value === true}
      onCheckedChange={(checked) => onChange(checked)}
    />
  );
}
