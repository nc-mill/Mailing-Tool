'use client';

import { X } from '../../icons';
import { cn } from '../../lib/cn';

export type ToastLabels = {
  undo: string;
  close: string;
  notifications: string;
  countdown: (seconds: number) => string;
  repeated: (message: string, count: number) => string;
};

export function ToastItem({
  tone,
  message,
  description,
  count,
  undoable,
  remainingSeconds,
  labels,
  onUndo,
  onClose,
  onPause,
  onResume,
}: {
  tone: 'info' | 'success' | 'error';
  message: string;
  description?: string | undefined;
  count: number;
  undoable: boolean;
  remainingSeconds: number | null;
  labels: ToastLabels;
  onUndo: () => void;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
    <div
      // Chyba přeruší čtení, informace ne (mapování 5.10).
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={onResume}
      className={cn(
        'pointer-events-auto flex w-[min(26rem,calc(100vw-2rem))] items-start gap-3',
        'rounded-[var(--radius-surface)] border p-4 shadow-lg',
        tone === 'error'
          ? 'border-danger bg-danger-surface text-danger-text'
          : 'border-border bg-surface-overlay text-text',
      )}
    >
      <div className="flex-1">
        <p className="text-sm font-medium">
          {count > 1 ? labels.repeated(message, count) : message}
        </p>
        {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
        {undoable && remainingSeconds !== null ? (
          <p className="mt-1 text-sm text-text-muted">{labels.countdown(remainingSeconds)}</p>
        ) : null}
      </div>
      {undoable ? (
        <button
          type="button"
          onClick={onUndo}
          className="min-h-11 rounded-[var(--radius-control)] px-3 text-sm font-medium text-accent-text"
        >
          {labels.undo}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label={labels.close}
        className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted"
      >
        <X aria-hidden className="icon-sm" />
      </button>
    </div>
  );
}
