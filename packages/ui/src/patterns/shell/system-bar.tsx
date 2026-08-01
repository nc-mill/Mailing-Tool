import { cn } from '../../lib/cn';

/**
 * Systémový pruh dole ukazuje **nejvýš jeden** stav.
 * Pořadí je závazné (tabulka 7.4) a nižší číslo vyhrává.
 */
const PRIORITY = [
  'sendingBlocked',
  'offline',
  'campaignRunning',
  'jobRunning',
  // Varování o záloze je nad zkušebním režimem schválně: zkušební režim
  // je trvalý stav, který by jinak vyhrával pořád, a časově omezené
  // varování o záloze by se nikdy nezobrazilo.
  'backupExpiring',
  'trialMode',
  'updateAvailable',
] as const;

export type SystemBarKind = (typeof PRIORITY)[number];

export type SystemBarState = {
  kind: SystemBarKind;
  message: string;
  action?: React.ReactNode;
};

const TONE: Record<SystemBarKind, string> = {
  sendingBlocked: 'border-danger bg-danger-surface text-danger-text',
  offline: 'border-warning bg-warning-surface text-warning-text',
  campaignRunning: 'border-border bg-surface-muted text-text',
  jobRunning: 'border-border bg-surface-muted text-text',
  backupExpiring: 'border-warning bg-warning-surface text-warning-text',
  trialMode: 'border-border bg-accent-surface text-accent-text',
  updateAvailable: 'border-border bg-accent-surface text-accent-text',
};

export function SystemBar({ states }: { states: SystemBarState[] }) {
  const [winner] = [...states].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  if (winner === undefined) return null;

  return (
    <div
      data-testid="system-bar"
      data-kind={winner.kind}
      role="status"
      className={cn(
        'fixed inset-x-0 bottom-0 z-[var(--z-systembar)] flex flex-wrap items-center',
        'justify-center gap-3 border-t px-4 py-2 text-sm',
        TONE[winner.kind],
      )}
    >
      <span>{winner.message}</span>
      {winner.action}
    </div>
  );
}
