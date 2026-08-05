import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { documentHasConfirmLink } from '@mlain/core/contacts';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ListDetail, type ListDetailData } from '@/features/contacts/list-detail';

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('lists.title') };
}

type ListApi = {
  id: string;
  name: string;
  opt_in: 'single' | 'double';
  confirmation_mode: 'one_step' | 'two_step';
  archived_at: string | null;
  public_visible: boolean;
  public_name: string | null;
  public_description: string | null;
  description: string | null;
  confirmation_ttl_hours: number;
  confirmation_max_resends: number;
  confirm_redirect_url: string | null;
  unsubscribe_redirect_url: string | null;
  is_default: boolean;
  send_welcome: boolean;
  send_goodbye: boolean;
  confirmation_template_id: string | null;
  welcome_template_id: string | null;
  goodbye_template_id: string | null;
};

type ListStats = { pending: number; confirmed: number };

type TemplateApi = { id: string; name: string; design: unknown };

/**
 * Jméno a stav připojené šablony.
 *
 * Načítá se po jedné, protože seznamy mají nanejvýš tři. Chybějící šablona
 * NENÍ chyba obrazovky: cizí klíč `ON DELETE SET NULL` sice odkaz do prázdna
 * nedovolí, ale mezi načtením seznamu a načtením šablony se dá smazat.
 */
async function loadTemplate(
  workspaceId: string,
  templateId: string | null,
): Promise<TemplateApi | null> {
  if (templateId === null) return null;
  // Detail šablony vrací objekt PŘÍMO, bez obálky `data`, na rozdíl od seznamů
  // a kontaktů. Sáhnout na `result.data.data` tady znamenalo `undefined` a hned
  // potom pětistovku „Cannot read properties of undefined (reading 'design')".
  const result = await apiFetch<TemplateApi>(`/api/v1/templates/${templateId}`, { workspaceId });
  return result.ok ? result.data : null;
}

export default async function ListDetailPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [detail, stats] = await Promise.all([
    apiFetch<{ data: ListApi }>(`/api/v1/lists/${id}`, { workspaceId }),
    apiFetch<ListStats>(`/api/v1/lists/${id}/stats`, { workspaceId }),
  ]);

  if (!detail.ok) {
    if (detail.problem.status === 404) notFound();
    return <ContactsProblem problem={detail.problem} />;
  }

  const api = detail.data.data;
  const [confirmation, welcome, goodbye] = await Promise.all([
    loadTemplate(workspaceId, api.confirmation_template_id),
    loadTemplate(workspaceId, api.welcome_template_id),
    loadTemplate(workspaceId, api.goodbye_template_id),
  ]);

  /*
   * Chybějící odkaz na potvrzení se počítá TÝMŽ pravidlem, které brání připojení
   * šablony (`documentHasConfirmLink`). Druhá implementace „hledej data.confirm_url"
   * by se s ním rozešla a obrazovka by mlčela nad e-mailem, ze kterého se nedá
   * potvrdit. Katalog polí je prázdný schválně: rozhoduje se podle cest, ne podle
   * typů, a načítat kvůli tomu celý katalog by bylo kolo navíc.
   */
  const hasConfirmLink =
    confirmation === null ||
    documentHasConfirmLink(confirmation.design as never, { version: 'v1', fields: [] });

  const list: ListDetailData = {
    id: detail.data.data.id,
    name: detail.data.data.name,
    confirmed_count: stats.ok ? stats.data.confirmed : 0,
    pending_count: stats.ok ? stats.data.pending : 0,
    double_opt_in: detail.data.data.opt_in === 'double',
    confirmation_mode: detail.data.data.confirmation_mode,
    archived: detail.data.data.archived_at !== null,
    public_visible: detail.data.data.public_visible,
    // Formulářová pole pracují s prázdným řetězcem, doména s null: „nevyplněno"
    // a „prázdné jméno" jsou dvě různé věci a překlad se dělá na téhle hranici.
    public_name: detail.data.data.public_name ?? '',
    public_description: detail.data.data.public_description ?? '',
    description: api.description ?? '',
    confirmation_ttl_hours: api.confirmation_ttl_hours,
    confirmation_max_resends: api.confirmation_max_resends,
    // Formulářová pole pracují s prázdným řetězcem, doména s null.
    confirm_redirect_url: api.confirm_redirect_url ?? '',
    unsubscribe_redirect_url: api.unsubscribe_redirect_url ?? '',
    is_default: api.is_default,
    emails: [
      {
        kind: 'confirmation',
        templateId: api.confirmation_template_id,
        templateName: confirmation?.name ?? null,
        // Potvrzení se vypnout nedá, viz `list-emails.tsx`.
        enabled: true,
        hasConfirmLink,
      },
      {
        kind: 'welcome',
        templateId: api.welcome_template_id,
        templateName: welcome?.name ?? null,
        enabled: api.send_welcome,
        hasConfirmLink: true,
      },
      {
        kind: 'goodbye',
        templateId: api.goodbye_template_id,
        templateName: goodbye?.name ?? null,
        enabled: api.send_goodbye,
        hasConfirmLink: true,
      },
    ],
  };

  return (
    <ListDetail
      basePath={`/w/${workspaceSlug}/lists`}
      templatesPath={`/w/${workspaceSlug}/templates`}
      workspaceId={workspaceId}
      language={locale.toLowerCase().startsWith('cs') ? 'cs' : 'en'}
      list={list}
    />
  );
}
