'use client';

import { useEffect, type RefObject } from 'react';
import { firstErrorField, type FieldErrors } from '@/lib/errors/field-errors';

/**
 * Po odeslání formuláře s chybou skočí fokus na první chybné pole,
 * viz požadavek na klávesnici v 11.3 části 6.
 */
export function useFormErrorFocus(
  errors: FieldErrors,
  formRef: RefObject<HTMLFormElement | null>,
): void {
  useEffect(() => {
    const name = firstErrorField(errors);
    if (!name) return;
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLElement) field.focus();
  }, [errors, formRef]);
}
