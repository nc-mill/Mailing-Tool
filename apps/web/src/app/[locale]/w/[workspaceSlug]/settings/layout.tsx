import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { SettingsNav } from '@/features/settings/settings-nav';
import { SettingsToasts } from '@/features/settings/settings-toasts';
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

  return (
    <SettingsToasts>
      <div className="grid gap-8 md:grid-cols-[14rem_1fr]">
        <aside>
          <SettingsNav workspaceSlug={workspaceSlug} permissions={access.data.permissions} />
        </aside>
        <div>{children}</div>
      </div>
    </SettingsToasts>
  );
}
