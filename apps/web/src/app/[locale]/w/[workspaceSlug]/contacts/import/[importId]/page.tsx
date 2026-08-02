import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ImportResult, type ImportResultRow } from '@/features/import/import-result';

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
  params: Promise<{ locale: string; workspaceSlug: string; importId: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('import');
  return { title: t('wizard.title') };
}

type ApiImport = {
  id: string;
  status: string;
  total_rows: number | null;
  checkpoint_row: number;
  error_rows: number;
  failure_detail: string | null;
  options: Record<string, unknown>;
};

const KNOWN = ['completed', 'completed_with_errors', 'cancelled', 'failed'] as const;

export default async function ImportResultPage({ params }: PageProps) {
  const { locale, workspaceSlug, importId } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const found = await apiFetch<ApiImport>(`/api/v1/contacts/imports/${importId}`, { workspaceId });
  if (!found.ok) notFound();

  const raw = found.data;
  const summary = (raw.options['error_summary'] ?? {}) as Record<string, number>;
  const status = (KNOWN as readonly string[]).includes(raw.status)
    ? (raw.status as ImportResultRow['status'])
    : 'failed';

  const row: ImportResultRow = {
    id: raw.id,
    status,
    totalRows: raw.total_rows ?? 0,
    createdRows: Number(raw.options['created_rows'] ?? 0),
    updatedRows: Number(raw.options['updated_rows'] ?? 0),
    suppressedRows: Number(raw.options['suppressed_rows'] ?? 0),
    errorRows: raw.error_rows,
    checkpointRow: raw.checkpoint_row,
    reviewRows: Number(raw.options['review_rows'] ?? 0),
    errorSummary: summary,
    failureDetail: raw.failure_detail,
  };

  return <ImportResult row={row} workspaceSlug={workspaceSlug} locale={locale} />;
}
