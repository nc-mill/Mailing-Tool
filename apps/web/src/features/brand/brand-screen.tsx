import 'server-only';
import { notFound } from 'next/navigation';
import { BrandSettingsClient } from '@/features/brand/brand-settings-client';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { aiWorkspaceContext, fetchBrandProfiles } from '@/lib/ai/queries';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/**
 * Tělo obrazovky 8.5.4. Bydlí tady, protože ji vykreslují dvě adresy:
 *
 *   - `/w/{slug}/brand`, kam míří položka `templates-brand` v registru
 *     navigace P05 (`mvp0: true`, takže ji uživatel v menu opravdu vidí),
 *   - `/w/{slug}/settings/brand`, kterou jmenuje plán P15 a e2e testy.
 *
 * Dvě tenké stránky nad jedním tělem jsou lepší než mrtvý odkaz v menu.
 */
export async function BrandScreen({ workspaceSlug }: { workspaceSlug: string }) {
  const me = await requireUser(`/w/${workspaceSlug}/brand`);
  if (!me.ok) return <SettingsProblem problem={me.problem} />;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'templates:write')) {
    return (
      <ForbiddenSection
        permission="templates:write"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const ctx = await aiWorkspaceContext({ userId: me.data.user.id, workspaceSlug });
  const profiles = await fetchBrandProfiles(ctx);

  return (
    <BrandSettingsClient
      workspaceId={access.data.workspace.id}
      profiles={profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        sourceUrl: profile.sourceUrl,
        logoAssetId: profile.logoAssetId,
        palette: profile.palette,
        typography: profile.typography,
        defaultProfile: profile.defaultProfile,
      }))}
    />
  );
}
