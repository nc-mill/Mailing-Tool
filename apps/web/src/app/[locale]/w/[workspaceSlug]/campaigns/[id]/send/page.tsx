import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { SendScreen } from '@/features/campaigns/send-screen';
import type { Preflight } from '@/features/campaigns/readiness-checklist';

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

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

type CampaignDetail = {
  id: string;
  name: string;
  subject: string;
  from_name: string;
  from_email: string;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.send');
  return { title: t('checklistTitle') };
}

/**
 * Obrazovka odeslání. Ukazuje, KOMU se to pošle, včetně rozpadu publika a počtu
 * vyřazených. Všechna čísla pocházejí z jednoho volání preflightu, aby se řádek
 * Publikum, tlačítko a potvrzovací dialog nemohly rozejít.
 */
export default async function SendPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const [campaign, preflight] = await Promise.all([
    apiFetch<CampaignDetail>(`/api/v1/campaigns/${id}`, { workspaceId }),
    apiFetch<Preflight>(`/api/v1/campaigns/${id}/preflight`, { workspaceId }),
  ]);

  if (!campaign.ok || !preflight.ok) notFound();

  const fromLine =
    campaign.data.from_name === ''
      ? campaign.data.from_email
      : `${campaign.data.from_name} <${campaign.data.from_email}>`;

  return (
    <SendScreen
      workspaceId={workspaceId}
      campaignId={id}
      campaignName={campaign.data.name}
      fromLine={fromLine}
      subject={campaign.data.subject}
      preflight={preflight.data}
      basePath={`/w/${workspaceSlug}`}
    />
  );
}
