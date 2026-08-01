import { Lock } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Stav S11. Nikdy jen „Nemáte oprávnění".
 * Texty se skládají v katalogu z parametrů `params` chyby `forbidden`
 * (requiredPermission, currentRole, grantedByRoles, contactableMembers).
 */
export function ForbiddenState({
  title,
  body,
  whoCanHelp,
  code,
  requestId,
  action,
  className,
}: {
  title: string;
  body: string;
  whoCanHelp?: string;
  code: 'forbidden' | 'insufficient_scope';
  requestId: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="forbidden-state"
      data-error-code={code}
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-3 rounded-[var(--radius-surface)]',
        'border border-border bg-surface p-8',
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-text">
        <Lock aria-hidden className="size-5" />
        {title}
      </h2>
      <p className="text-sm text-text">{body}</p>
      {whoCanHelp ? <p className="text-sm text-text-muted">{whoCanHelp}</p> : null}
      {action}
      <p className="font-mono text-xs text-text-muted">{requestId}</p>
    </section>
  );
}
