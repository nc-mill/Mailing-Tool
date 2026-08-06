import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      className={cn(
        'min-h-[var(--size-target-min)] w-full rounded-[var(--radius-control)] border border-border-strong',
        'bg-field px-3.5 py-2.5 text-ui text-text placeholder:text-text-muted',
        'aria-[invalid=true]:border-danger',
        className,
      )}
    />
  );
});
