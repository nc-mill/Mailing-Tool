import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        className={cn(
          'min-h-[var(--size-textarea-min)] w-full resize-y rounded-[var(--radius-control)] border border-border-strong',
          'bg-field px-3.5 py-2.5 text-ui text-text placeholder:text-text-muted',
          'aria-[invalid=true]:border-danger',
          className,
        )}
      />
    );
  },
);
