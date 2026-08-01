'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, useId, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-normal text-center',
    'min-h-11 rounded-[var(--radius-control)] px-4 text-sm font-medium',
    'transition-colors duration-[var(--duration-fast)]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        destructive: 'bg-danger text-danger-foreground hover:brightness-110',
        secondary: 'border border-border-strong bg-surface text-text hover:bg-surface-muted',
        ghost: 'bg-transparent text-text hover:bg-surface-muted',
        link: 'min-h-0 bg-transparent px-0 text-accent-text underline underline-offset-4',
      },
      size: {
        sm: 'min-h-11 px-3 text-sm',
        md: 'min-h-11 px-4 text-sm',
        lg: 'min-h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

type NativeProps = Omit<ComponentPropsWithoutRef<'button'>, 'disabled' | 'children'>;

type SharedProps = NativeProps &
  Pick<VariantProps<typeof buttonVariants>, 'size'> & {
    children: React.ReactNode;
    className?: string;
    /** Akce běží. Tlačítko zůstává čitelné a klikatelné, ale akci nespustí podruhé. */
    pending?: boolean;
    /** Text během čekání, například „Ukládáme…". Bez něj zůstává původní popisek. */
    pendingLabel?: string;
  };

/**
 * Primární a destruktivní tlačítko `disabled` nepřijímá (princip P5, kritérium 18).
 * Když akci nejde provést, předá se `unavailableReason`: tlačítko zůstane funkční,
 * vysvětlí důvod a místo akce zavolá `onUnavailable`.
 */
type LoudProps = SharedProps & {
  variant: 'primary' | 'destructive';
  disabled?: never;
  unavailableReason?: string;
  onUnavailable?: () => void;
};

type QuietProps = SharedProps & {
  variant?: 'secondary' | 'ghost' | 'link';
  disabled?: boolean;
  unavailableReason?: never;
  onUnavailable?: never;
};

export type ButtonProps = LoudProps | QuietProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    className,
    variant = 'secondary',
    size,
    children,
    pending = false,
    pendingLabel,
    onClick,
    unavailableReason,
    onUnavailable,
    ...rest
  } = props as SharedProps & {
    variant?: ButtonProps['variant'];
    unavailableReason?: string;
    onUnavailable?: () => void;
    disabled?: boolean;
  };
  const reasonId = useId();
  const isUnavailable = Boolean(unavailableReason);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (isUnavailable) {
      event.preventDefault();
      onUnavailable?.();
      return;
    }
    onClick?.(event);
  };

  return (
    <>
      <button
        {...(rest as ComponentPropsWithoutRef<'button'>)}
        ref={ref}
        type={rest.type ?? 'button'}
        aria-busy={pending ? true : undefined}
        aria-describedby={isUnavailable ? reasonId : rest['aria-describedby']}
        data-pending={pending ? '' : undefined}
        data-unavailable={isUnavailable ? '' : undefined}
        className={cn(
          buttonVariants({ variant, size }),
          isUnavailable ? 'opacity-80' : '',
          className,
        )}
        onClick={handleClick}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>
      {isUnavailable ? (
        <span id={reasonId} className="mt-1 block text-sm text-text-muted">
          {unavailableReason}
        </span>
      ) : null}
    </>
  );
});
