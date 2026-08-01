import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

export const Label = forwardRef<HTMLLabelElement, ComponentPropsWithoutRef<'label'>>(function Label(
  { className, ...props },
  ref,
) {
  return (
    <label {...props} ref={ref} className={cn('block text-sm font-medium text-text', className)} />
  );
});
