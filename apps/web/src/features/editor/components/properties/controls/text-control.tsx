'use client';

import { Input } from '@mlain/ui/components/input';
import type { ControlProps } from '../prop-field';

export function TextControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  if (descriptor.kind !== 'text') return <></>;
  return (
    <Input
      id={id}
      data-autofocus={autoFocus ? '' : undefined}
      maxLength={descriptor.maxLength}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
