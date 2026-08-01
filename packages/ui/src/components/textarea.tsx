import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        className={cn(
          'min-h-24 w-full rounded-[var(--radius-control)] border border-border-strong',
          'bg-surface p-3 text-sm text-text placeholder:text-text-muted',
          'aria-[invalid=true]:border-danger',
          className,
        )}
      />
    );
  },
);
