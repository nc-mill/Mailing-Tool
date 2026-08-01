import { cn } from '../../lib/cn';

/** Stav S13. U smazaných entit s auditem se doplní kdo a kdy. */
export function NotFoundState({
  title,
  body,
  deletedNote,
  backLink,
  className,
}: {
  title: string;
  body: string;
  /** Například „Kampaň Letní výprodej smazal Petr Svoboda 12. 6. 2026." */
  deletedNote?: string;
  backLink: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="not-found-state"
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-3 rounded-[var(--radius-surface)]',
        'border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="text-sm text-text-muted">{body}</p>
      {deletedNote ? <p className="text-sm text-text">{deletedNote}</p> : null}
      <div>{backLink}</div>
    </section>
  );
}
