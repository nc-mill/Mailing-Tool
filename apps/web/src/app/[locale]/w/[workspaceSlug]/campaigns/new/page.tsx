import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { NewCampaignScreen, type TemplateOption } from '@/features/campaigns/new-campaign-screen';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 * Týž důvod jako u seznamu kampaní: v době sestavení žádná relace neexistuje
 * a `next build` na tom padá chybou, která nemíří na příčinu.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.new');
  return { title: t('contentTitle') };
}

/**
 * První krok zakládání kampaně. Statický úsek `new` vyhrává nad sousedním
 * `[id]`, takže se sem nedostane cesta na detail kampaně.
 */
export default async function NewCampaignPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  /*
   * `view=summary` vynechá dokument `design`, který je zdaleka největší sloupec
   * tabulky šablon a do výběru není k ničemu.
   *
   * Odpověď šablon má tvar `{ items, next_cursor }`, NE `{ data }` jako zbytek
   * API. Čtení `data.data` by tu vrátilo `undefined` a nabídka by byla prázdná,
   * aniž by cokoli spadlo.
   */
  const templates = await apiFetch<{ items: TemplateOption[] }>(
    '/api/v1/templates?kind=campaign&view=summary',
    { workspaceId },
  );

  return (
    <NewCampaignScreen
      workspaceId={workspaceId}
      basePath={`/w/${workspaceSlug}`}
      // Výpadek číselníku obrazovku neshodí: prázdným e-mailem se dá začít vždycky.
      templates={templates.ok ? templates.data.items : []}
    />
  );
}
