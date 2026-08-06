import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { CampaignsScreen } from '@/features/campaigns/campaigns-screen';
import type { CampaignRow } from '@/features/campaigns/campaign-list';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 *
 * Bez tohohle ji Next při `next build` vykreslí a spadne, protože v době
 * sestavení žádná relace neexistuje:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on <cesta>, exiting the build.
 *
 * Chyba nemíří na příčinu, takže se hledá v komponentách. Statická podoba
 * téhle stránky přitom neexistuje: obsah je pro každého jiný.
 */
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<{ status?: string; cursor?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.list');
  return { title: t('title') };
}

export default async function CampaignsPage({ params, searchParams }: PageProps) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();

  const page = await apiFetch<{ data: CampaignRow[] }>('/api/v1/campaigns', {
    workspaceId: access.data.workspace.id,
    searchParams: { status: query.status, cursor: query.cursor },
  });

  // Čtyři stavy obrazovky: chyba, prázdno, data. Stav načítání drží Next.js
  // přes loading.tsx a kostru řádků v komponentě.
  const state = !page.ok ? 'error' : page.data.data.length === 0 ? 'empty' : 'data';

  return (
    <CampaignsScreen
      rows={page.ok ? page.data.data : []}
      state={state}
      basePath={`/w/${workspaceSlug}`}
      workspaceId={access.data.workspace.id}
      /*
       * Práva se počítají TADY, ne v tabulce. Klientská komponenta o rolích nic
       * neví a vědět nemá; nabídka „…" jen dostane pět příznaků a podle nich
       * vynechá položky, které by na serveru skončily na 403.
       *
       * `editContent` je `templates:write` schválně: obsah kampaně je řádek
       * v `templates` a upravuje se přes `PATCH /api/v1/templates/{id}`, takže
       * právo na kampaně by tu bylo to nesprávné.
       */
      permissions={{
        editContent: hasPermission(access.data, 'templates:write'),
        write: hasPermission(access.data, 'campaigns:write'),
        send: hasPermission(access.data, 'campaigns:send'),
        control: hasPermission(access.data, 'campaigns:control'),
        remove: hasPermission(access.data, 'campaigns:delete'),
      }}
    />
  );
}
