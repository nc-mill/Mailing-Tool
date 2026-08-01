'use client';

import { useId, useState } from 'react';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import type { FieldErrors } from '@/lib/errors/field-errors';
import { FieldError, fieldAria } from './field-error';

export type PasswordFieldProps = {
  name: string;
  label: string;
  hint?: string;
  autoComplete: 'current-password' | 'new-password';
  errors: FieldErrors;
  showLabel: string;
  hideLabel: string;
};

/**
 * Popisek je vždy viditelný, placeholder ho nenahrazuje (11.3 části 6).
 * Vkládání ze schránky se nijak neomezuje, zákaz vkládání je zakázaný.
 */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();

  return (
    <div className="mb-4">
      <Label htmlFor={props.name}>{props.label}</Label>
      <div className="mt-1 flex gap-2">
        <Input
          id={props.name}
          name={props.name}
          type={visible ? 'text' : 'password'}
          autoComplete={props.autoComplete}
          {...(props.hint ? { 'aria-describedby': hintId } : {})}
          {...fieldAria(props.name, props.errors)}
        />
        <Button type="button" variant="ghost" onClick={() => setVisible((value) => !value)}>
          {visible ? props.hideLabel : props.showLabel}
        </Button>
      </div>
      {props.hint ? (
        <p id={hintId} className="mt-1 text-sm text-text-muted">
          {props.hint}
        </p>
      ) : null}
      <FieldError name={props.name} errors={props.errors} />
    </div>
  );
}
