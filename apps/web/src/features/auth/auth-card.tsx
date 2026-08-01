import type { ReactNode } from 'react';

export type AuthCardProps = {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({ title, lead, children, footer }: AuthCardProps) {
  return (
    <section className="rounded-[var(--radius-surface)] border border-border bg-surface p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-text">{title}</h1>
      {lead ? <p className="mt-2 text-text-muted">{lead}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 border-t border-border pt-4 text-sm">{footer}</div> : null}
    </section>
  );
}
