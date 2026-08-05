import 'server-only';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DEFAULT_PALETTE, DEFAULT_TYPOGRAPHY } from '@mlain/core/brand';
import { saveBrandProfileAction } from '@/features/brand/brand-actions';
import { BrandSettingsClient } from '@/features/brand/brand-settings-client';
import type { BrandFormValues } from '@/features/brand/brand-form';
import type { BrandLogoValue } from '@/features/brand/brand-logo-field';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { aiWorkspaceContext, fetchBrandExtractions, fetchBrandProfiles } from '@/lib/ai/queries';
import { apiFetch } from '@/lib/api-client/fetch';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/** Kolik posledních běhů se ukáže v historii stažení. */
const HISTORY_LIMIT = 10;

/**
 * Tělo obrazovky „Nastavení → Značka projektu".
 *
 * Adresa je jedna: `/w/{slug}/settings/brand`. Původní `/w/{slug}/brand` na ni
 * od 4. 8. 2026 jen přesměrovává, protože zadavatel rozhodl, že značka patří
 * do Nastavení (zapsáno v `packages/ui/src/patterns/navigation/registry.ts`).
 */
export async function BrandScreen({ workspaceSlug }: { workspaceSlug: string }) {
  const t = await getTranslations('ai');
  const me = await requireUser(`/w/${workspaceSlug}/settings/brand`);
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

  const workspaceId = access.data.workspace.id;
  const ctx = await aiWorkspaceContext({ userId: me.data.user.id, workspaceSlug });
  /*
   * PROJEKT MÁ JEDNU ZNAČKU, ne seznam.
   *
   * Obrazovka dřív pod formulářem vypisovala „Uložené značky" a v nich
   * šestkrát tentýž web, protože každé stažení zakládalo další profil. Seznam,
   * ve kterém se nedalo nic vybrat ani přejmenovat, jen počítal kliknutí.
   * Značku teď stažení PŘEPÍŠE (`saveExtractedBrandProfile`) a pod formulářem
   * je historie BĚHŮ: kdy jsme co odkud stáhli.
   */
  const [profiles, history] = await Promise.all([
    fetchBrandProfiles(ctx),
    fetchBrandExtractions(ctx, HISTORY_LIMIT),
  ]);
  const current = profiles.find((profile) => profile.defaultProfile) ?? profiles[0];

  /*
   * Adresa loga se skládá na serveru, ne v prohlížeči.
   *
   * Profil nese jen `logo_asset_id`; adresa souboru vzniká z `public_id`,
   * varianty a `ASSET_BASE_URL` a umí ji jedině API assetů. Dřív tady byl
   * `<img src={`/api/v1/assets/${logoAssetId}`}>`, což je adresa DETAILU
   * assetu: vrací JSON, ne obrázek, takže logo bylo vždy rozbité. Ověřeno
   * čtením `packages/core/src/assets/urls.ts`.
   */
  let logo: BrandLogoValue = null;
  if (current?.logoAssetId) {
    const asset = await apiFetch<{ url: string; original_filename: string }>(
      `/api/v1/assets/${current.logoAssetId}`,
      { workspaceId },
    );
    if (asset.ok) {
      logo = { id: current.logoAssetId, url: asset.data.url, name: asset.data.original_filename };
    }
  }

  const initial: BrandFormValues = {
    name: current?.name ?? access.data.workspace.name,
    primary: current?.palette.primary ?? DEFAULT_PALETTE.primary,
    secondary: current?.palette.secondary ?? DEFAULT_PALETTE.secondary,
    accent: current?.palette.accent ?? DEFAULT_PALETTE.accent,
    background: current?.palette.background ?? DEFAULT_PALETTE.background,
    text: current?.palette.text ?? DEFAULT_PALETTE.text,
    /*
     * Projekt bez uložené značky dostane návrh `system`, ne `DEFAULT_TYPOGRAPHY`
     * z jádra. Formulář pracuje s IDENTIFIKÁTORY písma (`system`, `arial`, …),
     * kdežto `DEFAULT_TYPOGRAPHY.headingStack` je hotový CSS zápis
     * „Arial, Helvetica, sans-serif", který by v nabídce neodpovídal žádné
     * položce. `system` je zároveň hodnota z `DEFAULT_THEME` blokového modelu,
     * takže náhled ukazuje totéž, co e-mail.
     *
     * (Obcházka kvůli vadě `brandToTheme`, která „Arial, Helvetica, sans-serif"
     * mapovala na Times New Roman, tady byla do 4. 8. 2026. Vada je opravená
     * v `packages/emails/src/base/brand.ts`, důvod pro `system` zůstal jen ten
     * výše.)
     */
    headingStack: current?.typography.headingStack ?? 'system',
    bodyStack: current?.typography.bodyStack ?? 'system',
    radius: current?.typography.radius ?? DEFAULT_TYPOGRAPHY.radius,
    logo,
  };

  return (
    <SettingsPageShell title={t('brand.title')} lead={t('brand.lead')}>
      <BrandSettingsClient
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        saveAction={saveBrandProfileAction}
        initial={initial}
        history={history}
      />
    </SettingsPageShell>
  );
}
