import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JobsBadge } from './jobs-badge';
import { JobsCenter } from './jobs-center';
import type { JobSummary } from './types';

const jobs: JobSummary[] = [
  {
    id: 'job-1',
    title: 'Rozesílka kampaně Letní výprodej',
    status: 'running',
    done: 3214,
    total: 12480,
    startedBy: 'Jana Nováková',
    href: '/w/eshop-kolo/jobs/job-1',
  },
  {
    id: 'job-2',
    title: 'Import kveten.csv',
    status: 'completedWithErrors',
    done: 4987,
    total: 5000,
    href: '/w/eshop-kolo/jobs/job-2',
  },
];

const labels = {
  title: 'Úlohy',
  running: 'Běží',
  finished: 'Dokončené',
  empty: 'Zatím nic neběželo.',
  open: 'Otevřít',
  history: 'Historie za posledních 30 dní',
  progressOf: (done: string, total: string) => `${done} z ${total}`,
  startedBy: (person: string) => `Spustil ${person}`,
  runningCount: (count: number) => `Běží ${count} úloh`,
};

describe('JobsCenter', () => {
  it('rozděluje běžící a dokončené úlohy', () => {
    render(
      <JobsCenter
        jobs={jobs}
        labels={labels}
        renderLink={(job) => <a href={job.href}>{labels.open}</a>}
      />,
    );
    const running = screen.getByRole('group', { name: 'Běží' });
    expect(within(running).getByText('Rozesílka kampaně Letní výprodej')).toBeVisible();
    const finished = screen.getByRole('group', { name: 'Dokončené' });
    expect(within(finished).getByText('Import kveten.csv')).toBeVisible();
  });

  it('běžící úloha má průběh s čitelnou hodnotou pro čtečku', () => {
    render(
      <JobsCenter
        jobs={jobs}
        labels={labels}
        renderLink={(job) => <a href={job.href}>{labels.open}</a>}
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3214 z 12480');
  });

  it('u cizí úlohy je vidět, kdo ji spustil', () => {
    render(
      <JobsCenter
        jobs={jobs}
        labels={labels}
        renderLink={(job) => <a href={job.href}>{labels.open}</a>}
      />,
    );
    expect(screen.getByText('Spustil Jana Nováková')).toBeVisible();
  });

  it('každá úloha má vlastní odkaz, který jde poslat kolegovi', () => {
    render(
      <JobsCenter
        jobs={jobs}
        labels={labels}
        renderLink={(job) => <a href={job.href}>{labels.open}</a>}
      />,
    );
    expect(screen.getAllByRole('link', { name: 'Otevřít' })[0]).toHaveAttribute(
      'href',
      '/w/eshop-kolo/jobs/job-1',
    );
  });

  it('bez úloh ukáže prázdný stav, ne prázdnou plochu', () => {
    render(<JobsCenter jobs={[]} labels={labels} renderLink={() => null} />);
    expect(screen.getByText('Zatím nic neběželo.')).toBeVisible();
  });

  it('odznak počítá jen běžící úlohy, dokončené odznak nedělají', () => {
    render(<JobsBadge jobs={jobs} labels={labels} onOpen={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Běží 1 úloh');
  });

  it('bez běžících úloh ikona zůstává, jen bez odznaku', () => {
    render(<JobsBadge jobs={[jobs[1]!]} labels={labels} onOpen={vi.fn()} />);
    expect(screen.getByRole('button')).toBeVisible();
    expect(screen.queryByTestId('jobs-badge-count')).toBeNull();
  });
});
