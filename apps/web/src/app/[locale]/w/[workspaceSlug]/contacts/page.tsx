import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { readCursor } from '@/lib/api-client/cursor';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ContactsTable, type ContactRow } from '@/features/contacts/contacts-table';
import { filtersToQuery, readContactFilters } from '@/features/contacts/filters';

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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('list.title') };
}

type ContactApiRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  /**
   * Sloupce oslovení. API je vrací od začátku (`ContactResponseSchema`), jen je
   * seznam do téhle chvíle zahazoval, takže se pátý pád, tedy hlavní odlišující
   * vlastnost produktu, na nejčastěji otevírané obrazovce vůbec neobjevil.
   */
  greeting: string;
  first_name_vocative: string | null;
  vocative_confidence: 'high' | 'low' | 'none';
  vocative_locked: boolean;
  locale: string;
  status: ContactRow['status'];
  processing_restricted: boolean;
  anonymized_at?: string | null;
  lists: { list_id: string; name: string; status: string; snooze_until: string | null }[];
  tags: { id: string; name: string }[];
  created_at: string;
};

type ContactPage = {
  data: ContactApiRow[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
};

/** Mapper API na řádek tabulky. Když se tvar odpovědi změní, mění se tenhle kus, ne komponenta. */
function toRow(contact: ContactApiRow): ContactRow {
  const snooze = contact.lists
    .map((list) => list.snooze_until)
    .filter((value): value is string => value !== null);
  return {
    id: contact.id,
    email: contact.email,
    name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null,
    greeting: {
      greeting: contact.greeting ?? '',
      first_name: contact.first_name,
      first_name_vocative: contact.first_name_vocative ?? null,
      vocative_confidence: contact.vocative_confidence ?? 'none',
      vocative_locked: contact.vocative_locked ?? false,
      locale: contact.locale ?? 'cs',
    },
    status: contact.status,
    processing_restricted: contact.processing_restricted,
    snooze_until: snooze.length > 0 ? snooze.toSorted().at(-1)! : null,
    anonymized_at: contact.anonymized_at ?? null,
    lists: contact.lists.map((list) => list.name),
    tags: contact.tags.map((tag) => tag.name),
    created_at: contact.created_at,
  };
}

export default async function ContactsPage({ params, searchParams }: PageProps) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const cursor = readCursor(query);
  const basePath = `/w/${workspaceSlug}/contacts`;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;
  const greetingEnabled = access.data.workspace.greeting_enabled;
  // Filtry se čtou AŽ ZA projektem, protože jeden z nich (nejisté oslovení)
  // existuje jen tam, kde projekt oslovení řeší.
  const filters = readContactFilters(query, { greetingEnabled });

  // Šest nezávislých požadavků najednou. Sekvenčně by se čekání sčítalo a seznam kontaktů
  // je nejčastěji otevíraná obrazovka produktu.
  //
  // Pátý je počet nejistých oslovení. Obrazovka „Kontrola oslovení" existovala,
  // ale vedl na ni jediný odkaz, a to z výsledku importu. Kdo kontakty nenaimportoval,
  // nebo se k výsledku nevrátil, se o ní nedozvěděl.
  //
  // Projekt, který oslovení neřeší, ten pátý požadavek NEDĚLÁ. Odkaz, který by
  // z něj vznikl, by mířil na skrytou obrazovku.
  //
  // Šestý je počet nepotvrzených kontaktů do meta řádku pod názvem obrazovky. Je
  // ZÁMĚRNĚ MIMO AKTUÁLNÍ FILTR: má říct, kolik jich v projektu čeká celkem, tedy
  // i tehdy, když je zrovna vidět jeden seznam. Filtrovaný počet už stojí vedle něj.
  const [page, count, lists, tags, review, unconfirmed] = await Promise.all([
    apiFetch<ContactPage>('/api/v1/contacts', {
      workspaceId,
      searchParams: filtersToQuery(filters, { cursor, limit: 50 }),
    }),
    apiFetch<{ count: number; precision: 'exact' | 'estimated' }>('/api/v1/contacts/count', {
      workspaceId,
      searchParams: filtersToQuery(filters, {}),
    }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/lists', { workspaceId }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/tags', {
      workspaceId,
      searchParams: { limit: 200 },
    }),
    greetingEnabled
      ? apiFetch<{ groups: number; contacts: number }>('/api/v1/vocative-review/count', {
          workspaceId,
        })
      : null,
    apiFetch<{ count: number; precision: 'exact' | 'estimated' }>('/api/v1/contacts/count', {
      workspaceId,
      searchParams: { status: 'unconfirmed' },
    }),
  ]);

  if (!page.ok) return <ContactsProblem problem={page.problem} />;

  const tagList = tags.ok ? tags.data.data : [];
  // Seznamy se do téhle chvíle používaly JEN na popisky filtrů. Hromadné přidání do
  // seznamu je potřebuje jako nabídku, jinak by nad tabulkou byla nabídka bez obsahu.
  const listOptions = lists.ok ? lists.data.data : [];
  const names = {
    lists: Object.fromEntries(listOptions.map((list) => [list.id, list.name])),
    tags: Object.fromEntries(tagList.map((tag) => [tag.id, tag.name])),
    segments: {},
  };

  return (
    <ContactsTable
      basePath={basePath}
      workspaceId={workspaceId}
      rows={page.data.data.map(toRow)}
      pagination={page.data.pagination}
      total={count.ok ? { count: count.data.count, precision: count.data.precision } : null}
      // Když se počet nepodaří zjistit, prop se vynechá a meta řádek o nepotvrzených
      // mlčí. Nula by tvrdila, že žádný nečeká, což o neznámém čísle nevíme.
      {...(unconfirmed.ok ? { unconfirmed: unconfirmed.data.count } : {})}
      filters={filters}
      names={names}
      tags={tagList}
      lists={listOptions}
      greetingEnabled={greetingEnabled}
      // Počet nejistých oslovení. Když se endpoint nepodaří zavolat, odkaz se ukáže
      // bez čísla: odkaz na frontu je pravdivý vždycky, číslo jen tehdy, když ho víme.
      // S vypnutým oslovením se prop vynechá úplně, viz `exactOptionalPropertyTypes`.
      {...(greetingEnabled
        ? {
            vocativeReview: {
              href: `${basePath}/vocative-review`,
              ...(review?.ok ? { uncertain: review.data.contacts } : {}),
            },
          }
        : {})}
    />
  );
}
