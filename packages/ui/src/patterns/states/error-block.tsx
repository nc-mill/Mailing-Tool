'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '../../components/button';
import { Collapsible } from '../../components/collapsible';
import { CopyButton } from '../../components/copy-button';
import { cn } from '../../lib/cn';

export type ProblemSummary = {
  /** Strojový kód z RFC 9457 odpovědi. */
  code: string;
  requestId: string;
  occurredAt: Date;
  path?: string;
};

export type ErrorBlockLabels = {
  technicalDetails: string;
  code: string;
  requestId: string;
  time: string;
  copyBlock: string;
  copied: string;
  tryAgain: string;
};

export function ErrorBlock({
  title,
  reason,
  problem,
  onRetry,
  labels,
  className,
}: {
  /** Co se stalo. Fakticky, v aktivním rodu, bez omluv. */
  title: string;
  /** Proč. Když to nevíme, volající sem dá `detail` ze serveru. Nikdy si nevymýšlíme. */
  reason: string;
  problem: ProblemSummary;
  onRetry?: () => void;
  labels: ErrorBlockLabels;
  className?: string;
}) {
  const block = [
    `${labels.code}: ${problem.code}`,
    `${labels.requestId}: ${problem.requestId}`,
    `${labels.time}: ${problem.occurredAt.toISOString()}`,
    problem.path ? `${problem.path}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <section
      data-testid="error-block"
      // Kód v DOM je pro testy, člověk ho čte ve sbalených podrobnostech.
      data-error-code={problem.code}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-surface)] border border-danger',
        'bg-danger-surface p-6',
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-danger-text">
        <AlertTriangle aria-hidden className="size-5" />
        {title}
      </h2>
      <p className="text-sm text-text">{reason}</p>
      {onRetry ? (
        <div>
          <Button variant="secondary" onClick={onRetry}>
            {labels.tryAgain}
          </Button>
        </div>
      ) : null}
      <Collapsible summary={labels.technicalDetails}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-sm text-text">
          <dt className="text-text-muted">{labels.code}</dt>
          <dd>{problem.code}</dd>
          <dt className="text-text-muted">{labels.requestId}</dt>
          <dd>{problem.requestId}</dd>
          <dt className="text-text-muted">{labels.time}</dt>
          <dd>
            <time dateTime={problem.occurredAt.toISOString()}>
              {problem.occurredAt.toISOString()}
            </time>
          </dd>
        </dl>
        {/* Kopírování bydlí v primitivu, aby existovalo jednou.
            Stejné tlačítko používají klíče k API i DNS záznamy. */}
        <CopyButton
          className="mt-3"
          value={block}
          label={labels.copyBlock}
          copiedLabel={labels.copied}
        />
      </Collapsible>
    </section>
  );
}
