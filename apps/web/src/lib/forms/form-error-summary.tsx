'use client';

import { useEffect, useRef } from 'react';
import type { FieldErrors } from '@/lib/errors/field-errors';
import { FORM_LEVEL_KEY } from '@/lib/errors/field-errors';

export type FormErrorSummaryProps = {
  errors: FieldErrors;
  /** Souhrn se podle 5.5 části 6 ukazuje u formulářů delších než šest polí. */
  fieldCount: number;
  heading: string;
};

export function FormErrorSummary({ errors, fieldCount, heading }: FormErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors);

  useEffect(() => {
    if (entries.length > 0) ref.current?.focus();
  }, [entries.length]);

  if (entries.length === 0) return null;
  if (fieldCount <= 6 && !Object.hasOwn(errors, FORM_LEVEL_KEY)) return null;

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="mb-4 rounded-[var(--radius-surface)] border border-danger bg-danger-surface p-3"
    >
      <p className="font-medium text-danger-text">{heading}</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-text">
        {entries.flatMap(([field, messages]) =>
          messages.map((message) => <li key={`${field}-${message}`}>{message}</li>),
        )}
      </ul>
    </div>
  );
}
