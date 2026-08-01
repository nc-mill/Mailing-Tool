'use client';

import { cloneElement, isValidElement, useId } from 'react';
import { cn } from '../lib/cn';
import { Label } from './label';

type FieldChild = React.ReactElement<{
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
}>;

export type FieldProps = {
  label: string;
  children: FieldChild;
  /** Trvalá nápověda pod polem. */
  hint?: string;
  /** Chyba se ukazuje až po opuštění pole, nikdy při psaní (pravidlo 5.5). */
  error?: string;
  /** Povinnost se neznačí hvězdičkou. U našich formulářů je většina polí povinná,
   *  takže se označují ta nepovinná. */
  optionalLabel?: string;
  className?: string;
};

export function Field({ label, children, hint, error, optionalLabel, className }: FieldProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  if (!isValidElement(children)) {
    throw new Error('Field očekává právě jeden formulářový prvek jako potomka.');
  }

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={inputId}>
        {label}
        {optionalLabel ? (
          <span className="ml-1 font-normal text-text-muted">{optionalLabel}</span>
        ) : null}
      </Label>
      {cloneElement(children, {
        id: inputId,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
