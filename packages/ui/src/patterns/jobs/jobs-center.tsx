'use client';

import { Progress } from '../../components/progress';
import { RUNNING_STATUSES, type JobSummary, type JobsLabels } from './types';

/**
 * Centrum úloh. Jediné místo, kde uživatel najde všechno, co běží
 * nebo běželo na pozadí. Bez něj by dlouhé operace existovaly jen
 * v okně, ve kterém byly spuštěné.
 *
 * Komponenta je prezentační. Data i akce dodává obrazovka.
 */
export function JobsCenter({
  jobs,
  labels,
  renderLink,
  actions,
}: {
  jobs: JobSummary[];
  labels: JobsLabels;
  renderLink: (job: JobSummary) => React.ReactNode;
  actions?: (job: JobSummary) => React.ReactNode;
}) {
  const running = jobs.filter((job) => RUNNING_STATUSES.includes(job.status));
  const finished = jobs.filter((job) => !RUNNING_STATUSES.includes(job.status));

  if (jobs.length === 0) {
    return <p className="p-4 text-sm text-text-muted">{labels.empty}</p>;
  }

  function section(title: string, items: JobSummary[]) {
    if (items.length === 0) return null;
    return (
      <div role="group" aria-label={title}>
        <h3 className="px-4 py-2 text-sm font-medium text-text-muted">{title}</h3>
        <ul className="flex flex-col gap-2 px-4">
          {items.map((job) => (
            <li key={job.id} className="rounded-[var(--radius-control)] border border-border p-3">
              <p className="text-sm font-medium text-text">{job.title}</p>
              {RUNNING_STATUSES.includes(job.status) ? (
                <Progress
                  className="mt-2"
                  value={job.done}
                  max={job.total}
                  label={job.title}
                  valueText={labels.progressOf(String(job.done), String(job.total))}
                />
              ) : null}
              {job.note ? <p className="mt-1 text-sm text-text-muted">{job.note}</p> : null}
              {job.startedBy ? (
                <p className="mt-1 text-sm text-text-muted">{labels.startedBy(job.startedBy)}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {renderLink(job)}
                {actions?.(job)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {section(labels.running, running)}
      {section(labels.finished, finished)}
      <p className="px-4 text-sm text-text-muted">{labels.history}</p>
    </div>
  );
}
