export type JobStatus =
  'running' | 'paused' | 'completed' | 'completedWithErrors' | 'failed' | 'cancelled';

export type JobSummary = {
  id: string;
  title: string;
  status: JobStatus;
  done: number;
  total: number;
  /** U cizí úlohy je vidět, kdo ji spustil (pravidlo 5.7). */
  startedBy?: string;
  href: string;
  finishedAtLabel?: string;
  note?: string;
};

export type JobsLabels = {
  title: string;
  running: string;
  finished: string;
  empty: string;
  open: string;
  history: string;
  progressOf: (done: string, total: string) => string;
  startedBy: (person: string) => string;
  runningCount: (count: number) => string;
};

export const RUNNING_STATUSES: JobStatus[] = ['running', 'paused'];
