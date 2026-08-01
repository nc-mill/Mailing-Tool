import type { ReactNode } from 'react';
import { ReadOnlyBanner } from '@mlain/ui/patterns/states';

export type SettingsPageShellProps = {
  title: string;
  lead?: string | undefined;
  /** Primární akce vpravo v hlavičce, viz rozložení 4.2 části 6. */
  action?: ReactNode | undefined;
  /** Pruh stavu S12. Formuláře pod ním se vykreslují jako text, ne zašedle. */
  /** Důvod jedinou větou. `ReadOnlyBanner` z P05 bere `reason`, ne nadpis a popis. */
  readOnly?: { reason: string } | undefined;
  children: ReactNode;
};

export function SettingsPageShell({
  title,
  lead,
  action,
  readOnly,
  children,
}: SettingsPageShellProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {lead ? <p className="mt-2 text-text-muted">{lead}</p> : null}
        </div>
        {action}
      </div>
      {readOnly ? (
        <div className="mt-4">
          <ReadOnlyBanner reason={readOnly.reason} />
        </div>
      ) : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}
