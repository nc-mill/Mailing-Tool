import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getProvider } from '@mlain/core/ai';
import { Link } from '@mlain/i18n/navigation';
import { NotFoundState } from '@mlain/ui/patterns/states';
import { AiAssistantPanel } from '@/features/ai/assistant-panel';
import { CampaignContentChrome } from '@/features/campaigns/content-step-chrome';
import { CreateCampaignContent } from '@/features/campaigns/create-content';
import { isFinishedCampaign } from '@/features/campaigns/campaign-target';
import { campaignStepHref } from '@/features/campaigns/steps';
import { validationProfileFor, type TemplateKind } from '@mlain/emails/document/profile';
import { loadEditorData } from '@/features/editor/ports/server-ports';
import { apiFetch } from '@/lib/api-client/fetch';
import {
  aiWorkspaceContext,
  fetchBrandProfiles,
  fetchCredentials,
  fetchUsage,
} from '@/lib/ai/queries';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { CampaignEditorClient } from './editor-client';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. Totéž
 * a ze stejného důvodu dělá detail kampaně i editor šablony.
 */
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ locale: string; workspaceSlug: string; id: string }>;
};

type CampaignDetail = {
  id: string;
  name: string;
  status: string;
  template_id: string | null;
  has_design: boolean;
};

/** Stavy, ve kterých se obsah kampaně ještě smí měnit. Shodné s detailem kampaně. */
const EDITABLE_STATUSES = new Set(['draft', 'schedule_missed']);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.settings');
  return { title: t('steps.content') };
}

/**
 * KROK 1 KAMPANĚ: editor obsahu.
 *
 * Není to odbočka z kampaně, je to kampaň sama. Dřív měl krok 1 vlastní
 * obrazovku s odkazem „Upravit obsah v editoru", takže se uživatel k psaní
 * e-mailu proklikával přes rozcestník a zpátky se vracel tlačítkem. Editor
 * je od téhle chvíle tím krokem: nese pás kroků, ovládání šablon i cestu na
 * krok 2, a všechno se ukládá jednou cestou přes pracovní kopii kampaně.
 */
export default async function CampaignContentPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;
  const t = await getTranslations('campaigns.settings');
  const tEditor = await getTranslations('editor');

  const me = await requireUser(`/w/${workspaceSlug}/campaigns/${id}/content`);
  if (!me.ok) notFound();

  const access = await getWorkspaceAccess(workspaceSlug);
  // Nečlen dostane 404, ne 403: z 403 by šlo zjistit, které projekty existují.
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const [campaign, templates] = await Promise.all([
    apiFetch<CampaignDetail>(`/api/v1/campaigns/${id}`, { workspaceId }),
    /*
     * `view=summary` vynechá dokument `design`, který je zdaleka největší sloupec
     * tabulky šablon a do nabídky k převzetí není k ničemu.
     */
    apiFetch<{ items: Array<{ id: string; name: string }> }>(
      '/api/v1/templates?kind=campaign&view=summary',
      { workspaceId },
    ),
  ]);
  if (!campaign.ok) notFound();

  /*
   * DOJETÁ KAMPAŇ SEM NEPATŘÍ. Obsah odeslané kampaně je doklad o tom, co komu
   * odešlo, a jediné, co u ní zbývá, jsou výsledky. Stejné pravidlo a stejný
   * cíl má detail kampaně.
   */
  if (isFinishedCampaign(campaign.data.status)) {
    redirect(`/${locale}/w/${workspaceSlug}/campaigns/${id}/report`);
  }

  const basePath = `/w/${workspaceSlug}`;
  const canEdit =
    EDITABLE_STATUSES.has(campaign.data.status) && hasPermission(access.data, 'templates:write');

  /*
   * Kampaň bez pracovní kopie nemá co otevřít. Jsou to kampaně z doby před
   * tímhle uspořádáním a kampaně, u kterých založení obsahu selhalo; místo
   * prázdného editoru se proto nabídne obsah založit, ať krok 1 není slepý.
   */
  if (campaign.data.template_id === null) {
    return (
      <CreateCampaignContent
        workspaceId={workspaceId}
        campaignId={campaign.data.id}
        campaignName={campaign.data.name}
        basePath={basePath}
        canEdit={canEdit}
      />
    );
  }

  const data = await loadEditorData({
    userId: me.data.user.id,
    workspaceSlug,
    templateId: campaign.data.template_id,
  });
  if (!data) {
    return (
      <NotFoundState
        title={tEditor('state.notFound')}
        body={tEditor('state.notFoundBody')}
        backLink={
          <Link href={campaignStepHref(basePath, id, 'basics')} className="underline">
            {t('steps.basics')}
          </Link>
        }
      />
    );
  }

  /*
   * Podklady pro panel asistenta. Čtou se týmiž funkcemi jako v editoru šablony,
   * aby existoval jediný zdroj pravdy o tom, jestli projekt má klíč. Bez tohohle
   * by uživatel psaním kampaně o asistenta přišel, přestože v šabloně ho má.
   */
  const aiCtx = await aiWorkspaceContext({ userId: me.data.user.id, workspaceSlug });
  const [credentials, brandProfiles, usage] = await Promise.all([
    fetchCredentials(aiCtx),
    fetchBrandProfiles(aiCtx),
    fetchUsage(aiCtx, 30),
  ]);
  const format = await getFormatter();
  const defaultBrand = brandProfiles.find((profile) => profile.defaultProfile) ?? brandProfiles[0];
  const defaultCredential =
    credentials.find((credential) => credential.default_credential) ?? credentials[0];
  const providerLabel =
    defaultCredential === undefined ? undefined : getProvider(defaultCredential.provider).label;
  const spendLabel =
    usage.estimatedCostUsd === null
      ? undefined
      : format.number(usage.estimatedCostUsd, { style: 'currency', currency: 'USD' });

  return (
    <CampaignEditorClient
      templateId={campaign.data.template_id}
      workspaceId={workspaceId}
      /*
       * Pracovní obsah kampaně má `kind = 'system'`, což `validationProfileFor`
       * mapuje na kampaňový profil. Je to schválně: ten dokument JE obsahem
       * kampaně a musí projít týmiž pravidly, jinak by editor mlčel a odeslání
       * by spadlo.
       */
      templateKind={validationProfileFor(data.kind as TemplateKind)}
      document={data.document}
      designHash={data.designHash}
      fieldCatalog={data.fieldCatalog}
      contentKind="campaign"
      /*
       * Hlavní akce editoru vede na DALŠÍ KROK, ne „zpět do kampaně": kampaň
       * je tahle obrazovka. `campaignId` říká editoru, že má při odchodu obsah
       * do kampaně převzít, jinak by v ní zůstala kopie z chvíle, kdy obsah
       * vznikal, a odešel by prázdný e-mail.
       */
      returnTo={{
        href: campaignStepHref(basePath, id, 'basics'),
        label: t('nextStep', { step: t('steps.basics') }),
        campaignId: id,
      }}
      chrome={
        <CampaignContentChrome
          workspaceId={workspaceId}
          campaignId={id}
          campaignName={campaign.data.name}
          workingCopyId={campaign.data.template_id}
          hasDesign={campaign.data.has_design}
          templates={templates.ok ? templates.data.items : []}
          basePath={basePath}
          readOnly={!canEdit}
        />
      }
      canWriteHtml={canEdit}
      readOnly={!canEdit}
      assistant={
        <AiAssistantPanel
          templateId={campaign.data.template_id}
          workspaceId={workspaceId}
          hasCredential={credentials.length > 0}
          brandName={defaultBrand?.name ?? null}
          {...(providerLabel === undefined ? {} : { providerLabel })}
          settingsHref={`${basePath}/settings/ai`}
          {...(spendLabel === undefined ? {} : { spendLabel })}
        />
      }
    />
  );
}
