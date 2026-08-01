'use client';

import { Settings } from 'lucide-react';
import { RUNNING_STATUSES, type JobSummary, type JobsLabels } from './types';

/**
 * Odznak počítá **běžící** úlohy. Dokončené odznak nedělají,
 * aby se nedalo dostat do stavu trvale svítící ikony.
 * Ikona zůstává i bez běžících úloh, aby šla najít historie.
 */
export function JobsBadge({
  jobs,
  labels,
  onOpen,
}: {
  jobs: JobSummary[];
  labels: JobsLabels;
  onOpen: () => void;
}) {
  const running = jobs.filter((job) => RUNNING_STATUSES.includes(job.status)).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={running > 0 ? labels.runningCount(running) : labels.title}
      className="relative flex size-11 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-muted"
    >
      <Settings aria-hidden className="size-5" />
      {running > 0 ? (
        <span
          data-testid="jobs-badge-count"
          aria-hidden
          className="absolute right-1 top-1 min-w-4 rounded-full bg-primary px-1 text-center text-xs text-primary-foreground"
        >
          {running}
        </span>
      ) : null}
    </button>
  );
}
