import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { SettingsNav } from '@/features/settings/settings-nav';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const me = await requireUser(`/w/${workspaceSlug}/settings`);
  if (!me.ok) return <SettingsProblem problem={me.problem} />;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  // Oznámení sem NEPATŘÍ. `ToastProvider` montuje skořápka projektu
  // (`features/shell/workspace-shell.tsx`), která je nad každou obrazovkou pod
  // `/w/<projekt>`. Nastavení si ho do 5. 8. 2026 zapínalo ještě jednou samo,
  // z doby, kdy ho skořápka neměla.
  // Rozvržení: boční menu sekcí o šířce `--size-sidebar` a hlavní sloupec.
  // Mezera je `--spacing-gutter`, tedy tatáž, jakou má mřížka karet. Dřív tu
  // stálo `gap-8` a `14rem`, což jsou hodnoty z výchozí škály Tailwindu, ne
  // z návrhu. `minmax(0, 1fr)` je nutné, jinak široká tabulka v obsahu
  // roztáhne sloupec a rozbije mřížku.
  //
  // `items-start`, aby se lepivé menu mělo o co opřít: v `stretch` by měl
  // `<nav>` plnou výšku sloupce a `position: sticky` by neměl kam posouvat.
  return (
    <div className="grid items-start gap-[var(--spacing-gutter)] md:grid-cols-[var(--size-sidebar)_minmax(0,1fr)]">
      {/* Obal zůstává i tehdy, když `SettingsNav` nevykreslí nic (uživatel
          nemá ani jednu sekci). Bez něj by obsah spadl do úzkého prvního
          sloupce mřížky. */}
      <div>
        <SettingsNav workspaceSlug={workspaceSlug} permissions={access.data.permissions} />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
