import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ContactDetail, type ContactDetailData } from '@/features/contacts/contact-detail';

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

type ContactApiDetail = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  greeting: string;
  vocative_locked: boolean;
  /**
   * Jistota vokativu a jazyk kontaktu. API je vracelo od začátku, detail je ale
   * zahazoval, takže se z obrazovky nedalo poznat, jestli je tvar potvrzený,
   * odvozený ze slovníku, nebo odhadnutý.
   */
  first_name_vocative: string | null;
  vocative_confidence: 'high' | 'low' | 'none';
  locale: string;
  gender: 'female' | 'male' | 'unknown';
  status: ContactDetailData['status'];
  processing_restricted: boolean;
  anonymized_at?: string | null;
  updated_at: string;
  lists: {
    list_id: string;
    name: string;
    status: string;
    subscribed_at: string;
    snooze_until: string | null;
  }[];
  tags: { id: string; name: string }[];
  attributes: Record<string, unknown>;
  source: string;
  consents: { purpose: string; status: string; since: string }[];
};

type ContactFieldApi = { key: string; label: Record<string, string> };

/**
 * Podklad k větě o omezení zpracování. Vrací ho `GET /contacts/{id}` vedle kontaktu,
 * protože v tabulce `contacts` žádný čas omezení není: skládá se z auditního záznamu
 * `contact.processing_restricted`. Do téhle chvíle stránka posílala do rozhraní natvrdo
 * `null`, takže se ve větě „požádal o omezení" ukazovalo `updated_at`, tedy datum
 * poslední jakékoli změny kontaktu.
 */
type ContactRestrictionApi = {
  restricted_at: string;
  note: string | null;
  gdpr_request_id: string | null;
} | null;

/**
 * Titulek se nedělá druhým dotazem na kontakt. Byl by to stejný požadavek navíc a
 * e-mail v titulku prohlížeče je navíc osobní údaj viditelný v historii i na projektoru.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('list.title') };
}

export default async function ContactDetailPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  // Katalog vlastních polí se čte souběžně s kontaktem: bez něj by se atributy
  // vypsaly jako holé klíče (city místo Město).
  const [contact, fields] = await Promise.all([
    apiFetch<{ data: ContactApiDetail; restriction?: ContactRestrictionApi } | ContactApiDetail>(
      `/api/v1/contacts/${id}`,
      { workspaceId },
    ),
    apiFetch<{ data: ContactFieldApi[] }>('/api/v1/contact-fields', { workspaceId }),
  ]);

  if (!contact.ok) {
    if (contact.problem.status === 404) notFound();
    return <ContactsProblem problem={contact.problem} />;
  }

  // Obálka odpovědi se u detailu liší podle endpointu, proto obě větve.
  const payload = 'data' in contact.data ? (contact.data.data as ContactApiDetail) : contact.data;
  const restriction = 'restriction' in contact.data ? (contact.data.restriction ?? null) : null;

  const labels = new Map(
    (fields.ok ? fields.data.data : []).map((field) => [
      field.key,
      field.label[locale] ?? field.label['cs'] ?? field.key,
    ]),
  );
  const snooze = payload.lists
    .map((list) => list.snooze_until)
    .filter((value): value is string => value !== null);

  const data: ContactDetailData = {
    id: payload.id,
    email: payload.email,
    name: [payload.first_name, payload.last_name].filter(Boolean).join(' ') || null,
    greeting: payload.greeting,
    greeting_locked: payload.vocative_locked,
    greeting_status: {
      greeting: payload.greeting ?? '',
      first_name: payload.first_name,
      first_name_vocative: payload.first_name_vocative ?? null,
      vocative_confidence: payload.vocative_confidence ?? 'none',
      vocative_locked: payload.vocative_locked ?? false,
      locale: payload.locale ?? 'cs',
    },
    gender: payload.gender,
    status: payload.status,
    processing_restricted: payload.processing_restricted,
    snooze_until: snooze.length > 0 ? snooze.toSorted().at(-1)! : null,
    anonymized_at: payload.anonymized_at ?? null,
    status_changed_at: payload.updated_at,
    restriction:
      restriction === null
        ? null
        : { restricted_at: restriction.restricted_at, note: restriction.note },
    lists: payload.lists.map((list) => ({
      id: list.list_id,
      name: list.name,
      status: list.status,
    })),
    tags: payload.tags,
    attributes: Object.entries(payload.attributes).map(([key, value]) => ({
      key,
      label: labels.get(key) ?? key,
      value: String(value ?? ''),
    })),
    source: payload.source,
    subscribed_at: payload.lists[0]?.subscribed_at ?? null,
    consent_summary: payload.consents[0]?.purpose ?? null,
  };

  return (
    <ContactDetail
      basePath={`/w/${workspaceSlug}/contacts`}
      workspacePath={`/w/${workspaceSlug}`}
      workspaceId={workspaceId}
      contact={data}
      workspaceLocale={access.data.workspace.locale}
      greetingEnabled={access.data.workspace.greeting_enabled}
      // Omezení zpracování podle článku 18 drží `suppressions:write`, tedy admin a výš.
      // Server to kontroluje sám; tohle jen rozhoduje, jestli se ukáže tlačítko, nebo
      // věta o tom, koho požádat.
      canManageRestriction={hasPermission(access.data, 'suppressions:write')}
    />
  );
}
