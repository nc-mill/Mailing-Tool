import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { updateCampaignSettingsAction } from '@/features/campaigns/actions';
import {
  CampaignSettingsForm,
  type CampaignSettings,
  type NamedOption,
} from '@/features/campaigns/settings-form';

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
  status: string;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  template_id: string | null;
  audience: unknown;
  provider_id: string | null;
  sender_domain_id: string | null;
  unsubscribe_list_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
};

/**
 * Stavy, ve kterých se kampaň ještě smí měnit.
 *
 * Odpovídá bráně v `PATCH /campaigns/{id}`, která pro ostatní stavy vrací 409
 * `campaign_locked`. Naplánovaná kampaň sem schválně nepatří: povolené jsou
 * u ní jen tři klíče plánu a ty se nastavují jinou akcí, ne tímhle formulářem.
 */
const EDITABLE_STATUSES = new Set(['draft', 'schedule_missed']);

/**
 * `audience` je v odpovědi `unknown`, protože schéma kampaně nechává výčet
 * otevřený. Rozebírá se opatrně: obrazovka na chybějící nebo cizí tvar reaguje
 * prázdným výběrem, nikdy pádem.
 */
function audienceIds(audience: unknown, side: 'include' | 'exclude', key: 'lists' | 'segments') {
  const root = audience as Record<string, unknown> | null | undefined;
  const branch = root?.[side] as Record<string, unknown> | undefined;
  const values = branch?.[key];
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.settings');
  return { title: t('title') };
}

/**
 * Nastavení kampaně. Vzniklo proto, že obrazovka odeslání uměla vypsat, co
 * kampani chybí, ale předmět, publikum ani šablonu nešlo nikde vyplnit: cesta
 * `/campaigns/{id}` vracela 404, přestože `PATCH /api/v1/campaigns/{id}` existuje.
 */
export default async function CampaignSettingsPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const [campaign, lists, segments, templates, providers, domains] = await Promise.all([
    apiFetch<CampaignDetail>(`/api/v1/campaigns/${id}`, { workspaceId }),
    apiFetch<{ data: NamedOption[] }>('/api/v1/lists', { workspaceId }),
    apiFetch<{ data: NamedOption[] }>('/api/v1/segments', { workspaceId }),
    apiFetch<{ items: Array<{ id: string; name: string }> }>('/api/v1/templates?kind=campaign', {
      workspaceId,
    }),
    apiFetch<{ data: Array<{ id: string; name: string }> }>('/api/v1/providers', { workspaceId }),
    apiFetch<{ data: Array<{ id: string; domain: string }> }>('/api/v1/domains', { workspaceId }),
  ]);

  if (!campaign.ok) notFound();

  /*
   * Číselníky se načítají tolerantně. Když jeden z nich selže, obrazovka se
   * vykreslí s prázdnou nabídkou a uživatel může vyplnit zbytek; kdyby se
   * kvůli výpadku seznamu segmentů poslalo 404, nedal by se změnit ani předmět.
   */
  const options = {
    lists: lists.ok ? lists.data.data : [],
    segments: segments.ok ? segments.data.data : [],
    templates: templates.ok ? templates.data.items : [],
    providers: providers.ok ? providers.data.data : [],
    domains: domains.ok
      ? domains.data.data.map((row) => ({ id: row.id, name: row.domain }))
      : ([] as NamedOption[]),
  };

  const data = campaign.data;
  const settings: CampaignSettings = {
    id: data.id,
    name: data.name,
    status: data.status,
    subject: data.subject,
    preheader: data.preheader,
    from_name: data.from_name,
    from_email: data.from_email,
    reply_to: data.reply_to,
    template_id: data.template_id,
    provider_id: data.provider_id,
    sender_domain_id: data.sender_domain_id,
    unsubscribe_list_id: data.unsubscribe_list_id,
    track_opens: data.track_opens,
    track_clicks: data.track_clicks,
    include_lists: audienceIds(data.audience, 'include', 'lists'),
    include_segments: audienceIds(data.audience, 'include', 'segments'),
    exclude_lists: audienceIds(data.audience, 'exclude', 'lists'),
    exclude_segments: audienceIds(data.audience, 'exclude', 'segments'),
  };

  return (
    <CampaignSettingsForm
      action={updateCampaignSettingsAction}
      workspaceId={workspaceId}
      campaign={settings}
      options={options}
      canEdit={EDITABLE_STATUSES.has(data.status)}
      basePath={`/w/${workspaceSlug}`}
    />
  );
}
