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
  return (
    <div className="grid gap-8 md:grid-cols-[14rem_1fr]">
      <aside>
        <SettingsNav workspaceSlug={workspaceSlug} permissions={access.data.permissions} />
      </aside>
      <div>{children}</div>
    </div>
  );
}
