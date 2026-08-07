import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { pickEffectiveConsent, type ConsentPrecedenceRow } from '@mlain/core/contacts';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ContactForm, type ContactFormField } from '@/features/contacts/contact-form';
import { saveContactAction } from '@/features/contacts/edit-actions';

/** Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

/**
 * Řádek historie souhlasů z API. Tvar je záměrně ten, který bere
 * `pickEffectiveConsent`, aby se odpověď nemusela nikam překlápět.
 */
type ConsentApiRow = ConsentPrecedenceRow;

type ContactApiDetail = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  title_prefix: string | null;
  title_suffix: string | null;
  gender: 'female' | 'male' | 'unknown';
  greeting: string;
  vocative_locked: boolean;
  status: string;
  /** Do meta řádku pod nadpisem („přidán 4. 8. 2026"). */
  created_at?: string | null;
  anonymized_at?: string | null;
  attributes: Record<string, unknown>;
  tags: { id: string; name: string }[];
  lists: { list_id: string; name: string; status: string }[];
};

type ContactFieldApi = {
  key: string;
  label: Record<string, string>;
  type: ContactFormField['type'];
  archived_at: string | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('form.editTitle') };
}

/**
 * Hodnota vlastního pole do textového vstupu. Pole s víc hodnotami se spojuje čárkami,
 * protože stejným oddělovačem se v akci zase rozděluje.
 */
function toInputValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (Array.isArray(raw)) return raw.map(String).join(', ');
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return String(raw);
}

export default async function EditContactPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [contact, fields, tags, lists, consents] = await Promise.all([
    apiFetch<{ data: ContactApiDetail }>(`/api/v1/contacts/${id}`, { workspaceId }),
    apiFetch<{ data: ContactFieldApi[] }>('/api/v1/contact-fields', { workspaceId }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/tags', {
      workspaceId,
      searchParams: { limit: 200 },
    }),
    /*
     * `send_welcome` se čte schválně, stejně jako `opt_in`. Na seznamu s jedním
     * krokem se kontakt po zaškrtnutí přihlásí ROVNOU a potvrzovací e-mail
     * neodejde; místo něj odejde uvítací, ale jedině když ho seznam má zapnutý.
     * Bez tohohle příznaku formulář nemá jak poznat, jestli vůbec něco odejde,
     * a sliboval e-mail, který nikdy nedorazil.
     */
    apiFetch<{
      data: {
        id: string;
        name: string;
        opt_in: 'single' | 'double';
        send_welcome: boolean;
        /*
         * `send_goodbye` se čte ze stejného důvodu jako `send_welcome`, jen
         * na druhou stranu: ODŠKRTNUTÍ seznamu kontakt odhlásí a odhlášení
         * pošle rozloučení, pokud ho seznam má zapnuté (`unsubscribe.ts`).
         * Formulář o tom do 7. 8. 2026 mlčel, takže odchozí e-mail vyrobilo
         * kliknutí, po kterém uživatel čekal jen tichou změnu.
         */
        send_goodbye: boolean;
      }[];
    }>('/api/v1/lists', { workspaceId }),
    /*
     * Historie souhlasů, od nejnovějšího. Formulář z ní pozná, jestli po
     * zaškrtnutí seznamu s dvojím potvrzením odejde POTVRZOVACÍ e-mail, nebo
     * uvítací: kontakt s doloženým souhlasem se přihlásí rovnou
     * (`state-machine.ts`, větev `existingConsent`).
     *
     * Rozhoduje o tom `pickEffectiveConsent` z `@mlain/core`, tedy TÁŽ funkce,
     * kterou se ptá server. Opsané pravidlo by se rozešlo na něčem, co je vidět
     * až v doručené poště příjemce.
     */
    apiFetch<{ data: ConsentApiRow[] }>(`/api/v1/contacts/${id}/consents`, { workspaceId }),
  ]);

  if (!contact.ok) {
    if (contact.problem.status === 404) notFound();
    return <ContactsProblem problem={contact.problem} />;
  }
  const payload = contact.data.data;

  // Smazaný nebo anonymizovaný kontakt se needituje. Detail ho ukazuje jen ke čtení
  // a formulář by na něm stejně skončil chybou ze serveru; 404 je poctivější než
  // obrazovka, která vypadá použitelně a použitelná není.
  if (payload.status === 'deleted' || (payload.anonymized_at ?? null) !== null) notFound();

  const workspaceTags = tags.ok ? tags.data.data.map((tag) => tag.name) : [];
  // Štítky kontaktu, které v katalogu projektu chybí, se přidávají k nabídce.
  // Bez toho by uložení formuláře kontakt o takový štítek tiše připravilo.
  const tagNames = [...new Set([...workspaceTags, ...payload.tags.map((tag) => tag.name)])];
  const selectedTags = new Set(payload.tags.map((tag) => tag.name));

  const subscribed = new Set(
    payload.lists.filter((list) => list.status !== 'unsubscribed').map((list) => list.list_id),
  );
  /*
   * Odhlášené seznamy se drží zvlášť, ne jen jako „nezaškrtnuté". Zaškrtávátko
   * vypadá stejně jako u seznamu, ve kterém kontakt nikdy nebyl, ale následek je
   * jiný: návrat po odhlášení jde vždycky přes potvrzovací e-mail, i na seznamu
   * s jedním krokem (`state-machine.ts`, větev `from === 'unsubscribed'`).
   */
  const unsubscribed = new Set(
    payload.lists.filter((list) => list.status === 'unsubscribed').map((list) => list.list_id),
  );
  const listCatalog = lists.ok ? lists.data.data : [];
  /*
   * Když se historie souhlasů nenačte, bere se jako prázdná, tedy „souhlas
   * nemáme". Formulář pak slíbí potvrzovací e-mail, což je běžná cesta a to
   * horší z obou omylů to není: slíbit potvrzení a poslat uvítání je matoucí,
   * ale mlčet o odchozím e-mailu úplně je horší.
   */
  const consentLog = consents.ok ? consents.data.data : [];

  return (
    <ContactForm
      mode="edit"
      action={saveContactAction}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      basePath={`/w/${workspaceSlug}/contacts`}
      greetingEnabled={access.data.workspace.greeting_enabled}
      values={{
        id: payload.id,
        email: payload.email,
        first_name: payload.first_name ?? '',
        last_name: payload.last_name ?? '',
        title_prefix: payload.title_prefix ?? '',
        title_suffix: payload.title_suffix ?? '',
        gender: payload.gender,
        greeting: payload.greeting,
        greeting_locked: payload.vocative_locked,
        status: payload.status,
        created_at: payload.created_at ?? null,
        fields: (fields.ok ? fields.data.data : [])
          .filter((field) => field.archived_at === null)
          .map((field) => ({
            key: field.key,
            label: field.label[locale] ?? field.label['cs'] ?? field.key,
            type: field.type,
            value: toInputValue(payload.attributes[field.key]),
          })),
        tags: tagNames.map((name) => ({ name, selected: selectedTags.has(name) })),
        lists: listCatalog.map((list) => ({
          id: list.id,
          name: list.name,
          selected: subscribed.has(list.id),
          double_opt_in: list.opt_in === 'double',
          send_welcome: list.send_welcome,
          send_goodbye: list.send_goodbye,
          previously_unsubscribed: unsubscribed.has(list.id),
          has_effective_consent: pickEffectiveConsent(consentLog, { listId: list.id }) !== null,
        })),
      }}
    />
  );
}
