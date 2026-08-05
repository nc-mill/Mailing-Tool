import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AssetsLibrary } from '@/features/assets/assets-library';
import { toAssetRow, type ApiAssetList } from '@/features/assets/types';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/**
 * Knihovna médií projektu (`/w/{slug}/assets`).
 *
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 * Bez `dynamic = 'force-dynamic'` ji Next při `next build` vykreslí a spadne,
 * protože v době sestavení žádná relace neexistuje:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on <cesta>, exiting the build.
 *
 * Chyba nemíří na příčinu, takže se hledá v komponentách. Statická podoba téhle
 * stránky přitom neexistuje: obsah je pro každý projekt jiný.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('assets');
  return { title: t('library.title') };
}

/**
 * Limit velikosti jednoho souboru.
 *
 * Je to VÝCHOZÍ hodnota `ASSET_MAX_UPLOAD_MB` ze schématu konfigurace, opsaná,
 * ne načtená. `loadConfig()` na stránce volat nejde bez toho, aby si apps/web
 * přitáhl celý konfigurační modul jádra, a hodnota se používá jen ke dvěma
 * věcem: k větě „nejvýš 10 MB" a k odmítnutí souboru dřív, než se pošle. Obojí
 * je nápověda; ROZHODUJE SERVER, který limit čte ze své konfigurace. Instalace
 * se zvednutým limitem tedy neztratí nic, jen ukáže opatrnější číslo.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export default async function AssetsPage({ params }: PageProps) {
  const { locale, workspaceSlug } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    // Nečlen dostane 404, ne 403: existence projektu je sama o sobě informace.
    notFound();
  }

  if (!hasPermission(access.data, 'assets:read')) {
    return (
      <ForbiddenSection
        permission="assets:read"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const workspaceId = access.data.workspace.id;
  const canWrite = hasPermission(access.data, 'assets:write');

  // Limit 200 je strop, který připouští `GET /assets`. Stránkování kurzorem
  // knihovna zatím nepoužívá: mřížka s náhledy je vizuální výběr, ne tabulka,
  // a nad dvě stě dlaždicemi je rychlejší hledání než listování.
  const page = await apiFetch<ApiAssetList>('/api/v1/assets', {
    workspaceId,
    searchParams: { limit: 200 },
  });

  return (
    <AssetsLibrary
      initialAssets={page.ok ? page.data.data.map(toAssetRow) : []}
      workspaceId={workspaceId}
      canWrite={canWrite}
      loadFailed={!page.ok}
      maxUploadBytes={MAX_UPLOAD_BYTES}
      locale={locale}
    />
  );
}
