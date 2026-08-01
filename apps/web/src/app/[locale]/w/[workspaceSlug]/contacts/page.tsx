import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { readCursor } from '@/lib/api-client/cursor';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ContactsTable, type ContactRow } from '@/features/contacts/contacts-table';
import { filtersToQuery, readContactFilters } from '@/features/contacts/filters';

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
  const filters = readContactFilters(query);
  const cursor = readCursor(query);
  const basePath = `/w/${workspaceSlug}/contacts`;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  // Čtyři nezávislé požadavky najednou. Sekvenčně by se čekání sčítalo a seznam kontaktů
  // je nejčastěji otevíraná obrazovka produktu.
  const [page, count, lists, tags] = await Promise.all([
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
  ]);

  if (!page.ok) return <ContactsProblem problem={page.problem} />;

  const tagList = tags.ok ? tags.data.data : [];
  const names = {
    lists: Object.fromEntries(
      (lists.ok ? lists.data.data : []).map((list) => [list.id, list.name]),
    ),
    tags: Object.fromEntries(tagList.map((tag) => [tag.id, tag.name])),
    segments: {},
  };

  return (
    <ContactsTable
      basePath={basePath}
      rows={page.data.data.map(toRow)}
      pagination={page.data.pagination}
      total={count.ok ? { count: count.data.count, precision: count.data.precision } : null}
      filters={filters}
      names={names}
      tags={tagList}
    />
  );
}
