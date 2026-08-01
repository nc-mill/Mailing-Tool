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
        'min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong',
        'bg-surface px-3 text-sm text-text placeholder:text-text-muted',
        'aria-[invalid=true]:border-danger',
        className,
      )}
    />
  );
});
