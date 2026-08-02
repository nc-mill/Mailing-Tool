import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuditFilters } from '@/features/audit/audit-filters';
import { AuditTable, type AuditRow } from '@/features/audit/audit-table';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import {
  fetchListWithCursorFallback,
  readCursor,
  readFilters,
  type Paginated,
} from '@/lib/api-client/cursor';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('audit.title') };
}

/** Filtry podle 3.7 části 1. */
const AUDIT_FILTERS = ['action', 'actor_id', 'target_id', 'from', 'to'] as const;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'audit:read')) {
    return (
      <ForbiddenSection
        permission="audit:read"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const workspaceId = access.data.workspace.id;
  const filters = readFilters(query, AUDIT_FILTERS);
  const cursor = readCursor(query);
  const basePath = `/w/${workspaceSlug}/settings/audit`;

  const entries = await fetchListWithCursorFallback<AuditRow>(
    (nextCursor) =>
      apiFetch<Paginated<AuditRow>>('/api/v1/audit-log', {
        workspaceId,
        searchParams: { ...filters, cursor: nextCursor, limit: 50 },
      }),
    cursor,
  );

  return (
    <SettingsPageShell title={t('audit.title')} lead={t('audit.lead')}>
      <div className="space-y-8">
        <AuditFilters basePath={basePath} filters={filters} />
        <AuditTable
          entries={entries.result}
          filters={filters}
          basePath={basePath}
          cursorDropped={entries.cursorDropped}
        />
      </div>
    </SettingsPageShell>
  );
}
